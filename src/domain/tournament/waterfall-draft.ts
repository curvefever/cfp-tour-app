import type { RoomSize, TournamentRound } from './types';
import {
  ELIMINATED,
  LABEL_PATTERN,
  MAX_ROOMS_PER_ROUND,
  QUAL_LABEL,
  declaredWaterfallRooms,
  expandRankTokens,
  normalizeRoundLabel,
  parseWaterfallGraph,
  roomIndexToLetter,
  type WaterfallParseResult,
} from './waterfall-bracket';

/**
 * The waterfall editor's working copy of a graph. `PersistedSetup.waterfallGraph`
 * stays the source of truth (plain ROUNDS:/ROUTES: text); the editor parses it
 * into this shape on every render, changes it with the pure functions below,
 * and writes the text back. A slot is a round label or `null`, and `null` means
 * the rank is out, the same for a room and for the Qual source. The draft may
 * still be unfinished in other ways (a round nothing routes into, say).
 *
 * Nothing here re-implements the validation rules. Whether a draft is a
 * complete, consistent graph is still decided by
 * `validateAndOrderWaterfallGraph` on the serialized text, the same call
 * generation makes.
 *
 * A graph fed by a qualification table also has a Qual source (`qualRoutes`),
 * edited like a room whose slots are the standings ranks.
 */

export interface WaterfallDraftRound {
  label: string;
  roomCount: number;
  roomSize: number;
  isFinal: boolean;
}

/** A slot's destination: a round label, or null when the rank is out. */
export type WaterfallSlotDestination = string | null;

export interface WaterfallDraft {
  rounds: WaterfallDraftRound[];
  /** `routes[label][room][rank - 1]`. Empty for the Final, which routes nowhere. */
  routes: Record<string, WaterfallSlotDestination[][]>;
  /**
   * The qualification table's standings routing, `qualRoutes[rank - 1]` (null = eliminated); null when
   * the graph has no qualification table. Its length is how many ranks the editor shows.
   */
  qualRoutes: WaterfallSlotDestination[] | null;
}

export interface WaterfallDraftParseOptions {
  /** The graph is fed by a qualification table. Without a Qual line it is read as the entry round taking every rank. */
  standingsSource?: boolean;
  /** How many standings ranks to show (the registered head count), when known. */
  rankCount?: number;
  /** Ranks to show beyond the highest routed one while `rankCount` isn't known. */
  padRanks?: number;
}

export interface WaterfallSlot {
  /** 0-based room index within its round. */
  room: number;
  /** 1-based finishing rank within the room. */
  rank: number;
}

export const MAX_WATERFALL_ROOM_SIZE = 64;

function ok<T>(value: T): WaterfallParseResult<T> {
  return { ok: true, value };
}
function err<T>(error: string): WaterfallParseResult<T> {
  return { ok: false, error };
}

function unsetRoom(roomSize: number): WaterfallSlotDestination[] {
  return Array.from({ length: roomSize }, () => null);
}

function emptyRoutes(round: WaterfallDraftRound): WaterfallSlotDestination[][] {
  return round.isFinal ? [] : Array.from({ length: round.roomCount }, () => unsetRoom(round.roomSize));
}

/** The stored form of a destination: 'eliminated' and null are the same thing, kept as null. */
function storedDestination(destination: WaterfallSlotDestination): WaterfallSlotDestination {
  return destination === ELIMINATED ? null : destination;
}

/** Rebuilds every round's routes to match its declared shape, keeping whatever slots still exist. */
function reshapeRoutes(
  rounds: WaterfallDraftRound[],
  routes: Record<string, WaterfallSlotDestination[][]>,
): Record<string, WaterfallSlotDestination[][]> {
  const next: Record<string, WaterfallSlotDestination[][]> = {};
  for (const round of rounds) {
    const previous = routes[round.label] ?? [];
    next[round.label] = emptyRoutes(round).map((room, roomIndex) =>
      room.map((_, rankIndex) => previous[roomIndex]?.[rankIndex] ?? null),
    );
  }
  return next;
}

export function findWaterfallRound(draft: WaterfallDraft, label: string): WaterfallDraftRound | undefined {
  return draft.rounds.find((round) => round.label === label);
}

function labelIsTaken(draft: WaterfallDraft, label: string): boolean {
  const lower = label.toLowerCase();
  return draft.rounds.some((round) => round.label.toLowerCase() === lower);
}

/** Highest rank sent anywhere (not eliminated), 0 when none. */
export function highestRoutedQualRank(qualRoutes: WaterfallSlotDestination[]): number {
  return qualRoutes.reduce(
    (highest, destination, index) =>
      destination !== null && destination !== ELIMINATED ? index + 1 : highest,
    0,
  );
}

/** The "Advance to bracket" a Qual routing implies: the highest rank it sends on. */
export function waterfallQualAdvance(draft: WaterfallDraft): number {
  return draft.qualRoutes ? highestRoutedQualRank(draft.qualRoutes) : 0;
}

/** "Advance to bracket" read off graph text fed by a qualification table: the highest rank its Qual line sends on, 0 while unreadable or unset. */
export function waterfallGraphQualAdvance(text: string): number {
  const parsed = parseWaterfallDraft(text, { standingsSource: true });
  return parsed.ok ? waterfallQualAdvance(parsed.value) : 0;
}

/** How many ranks are sent on / eliminated out of `registered` (null while the head count isn't known). */
export function waterfallQualCounts(
  qualRoutes: WaterfallSlotDestination[],
  registered: number | null,
): { sentOn: number; eliminated: number | null } {
  const sentOn = qualRoutes.filter(
    (destination) => destination !== null && destination !== ELIMINATED,
  ).length;
  return { sentOn, eliminated: registered === null ? null : Math.max(0, registered - sentOn) };
}

function qualRoutesFromBands(
  bands: Array<{ rankTokens: string[]; destinationLabel: string }>,
  byLower: Map<string, WaterfallDraftRound>,
): WaterfallParseResult<WaterfallSlotDestination[]> {
  const destinations: WaterfallSlotDestination[] = [];
  const seen = new Set<number>();
  for (const band of bands) {
    const destination = resolveDestination(band.destinationLabel, byLower);
    if (destination === null) {
      return err(`Qual routes to "${band.destinationLabel}", which isn't declared in ROUNDS.`);
    }
    const ranks = expandRankTokens(band.rankTokens);
    if (!ranks.ok) return ranks;
    for (const rank of ranks.value) {
      if (rank < 1) return err(`Qual: rank ${rank} is out of range -- qualification ranks start at 1.`);
      if (seen.has(rank)) return err(`Qual: rank ${rank} is routed more than once.`);
      seen.add(rank);
      destinations[rank - 1] = storedDestination(destination);
    }
  }
  return ok(Array.from({ length: destinations.length }, (_, index) => destinations[index] ?? null));
}

/** The Qual routing of a draft: as written, or (no Qual line) the one round nothing routes into taking every rank, padded to the ranks shown. */
function buildQualRoutes(
  bands: Array<{ rankTokens: string[]; destinationLabel: string }> | null,
  draft: Pick<WaterfallDraft, 'rounds' | 'routes'>,
  byLower: Map<string, WaterfallDraftRound>,
  options: WaterfallDraftParseOptions,
): WaterfallParseResult<WaterfallSlotDestination[]> {
  let routed: WaterfallSlotDestination[] = [];
  if (bands) {
    const built = qualRoutesFromBands(bands, byLower);
    if (!built.ok) return built;
    routed = built.value;
  } else {
    const startingLabel = waterfallRoundIntake({ ...draft, qualRoutes: null }).startingRound;
    const entry = startingLabel ? byLower.get(startingLabel.toLowerCase()) : undefined;
    if (entry) routed = Array.from({ length: entry.roomCount * entry.roomSize }, () => entry.label);
  }
  const highest = highestRoutedQualRank(routed);
  const shown = Math.max(highest, options.rankCount ?? highest + (options.padRanks ?? 0), 1);
  return ok(Array.from({ length: shown }, (_, index) => routed[index] ?? null));
}

/** Reads ROUNDS:/ROUTES: text into a draft. Empty text is a valid, empty draft. */
export function parseWaterfallDraft(
  text: string,
  options: WaterfallDraftParseOptions = {},
): WaterfallParseResult<WaterfallDraft> {
  const raw = parseWaterfallGraph(text, { allowIncomplete: true });
  if (!raw.ok) return raw;

  const rounds: WaterfallDraftRound[] = raw.value.roundLines.map((line) => ({
    label: line.label,
    roomCount: line.roomSizes.length,
    roomSize: line.roomSizes[0],
    isFinal: line.isFinal,
  }));
  const byLower = new Map(rounds.map((round) => [round.label.toLowerCase(), round]));
  const routes = reshapeRoutes(rounds, {});
  const claimed = new Map<string, Set<number>>();

  for (const line of raw.value.routeLines) {
    const round = byLower.get(line.label.toLowerCase());
    if (!round) return err(`ROUTES references round "${line.label}", which isn't declared in ROUNDS.`);
    if (round.isFinal) {
      return err(`Round "${round.label}" is marked FINAL but has an outgoing ROUTES line.`);
    }
    if (line.room === null && round.roomCount > 1) {
      return err(
        `Round "${round.label}" has ${round.roomCount} rooms, so each ROUTES line needs a room letter.`,
      );
    }
    const roomIndex = (line.room ?? 1) - 1;
    if (roomIndex >= round.roomCount) {
      return err(`Round "${round.label}" only has ${round.roomCount} room(s).`);
    }
    const claimedKey = `${round.label}.${roomIndex}`;
    const claimedRanks = claimed.get(claimedKey) ?? new Set<number>();
    claimed.set(claimedKey, claimedRanks);
    for (const band of line.bands) {
      const destination = resolveDestination(band.destinationLabel, byLower);
      if (destination === null) {
        return err(
          `Round "${round.label}" routes to "${band.destinationLabel}", which isn't declared in ROUNDS.`,
        );
      }
      const ranks = expandRankTokens(band.rankTokens);
      if (!ranks.ok) return ranks;
      for (const rank of ranks.value) {
        const room = routes[round.label][roomIndex];
        if (rank < 1 || rank > round.roomSize) {
          return err(`Round "${round.label}": rank ${rank} is out of range for a room of ${round.roomSize}.`);
        }
        if (claimedRanks.has(rank)) {
          return err(`Round "${round.label}": rank ${rank} is routed more than once.`);
        }
        claimedRanks.add(rank);
        room[rank - 1] = storedDestination(destination);
      }
    }
  }
  if (!options.standingsSource || rounds.length === 0) return ok({ rounds, routes, qualRoutes: null });
  const qualRoutes = buildQualRoutes(raw.value.qualBands, { rounds, routes }, byLower, options);
  if (!qualRoutes.ok) return qualRoutes;
  return ok({ rounds, routes, qualRoutes: qualRoutes.value });
}

function resolveDestination(label: string, byLower: Map<string, WaterfallDraftRound>): string | null {
  if (label.toLowerCase() === ELIMINATED) return ELIMINATED;
  return byLower.get(label.toLowerCase())?.label ?? null;
}

/** Sorted ranks to compact tokens: [1,2,3,5] becomes ["1-3", "5"]. */
export function compressWaterfallRanks(ranks: number[]): string[] {
  const sorted = [...ranks].sort((first, second) => first - second);
  const tokens: string[] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    tokens.push(end > start ? `${sorted[start]}-${sorted[end]}` : String(sorted[start]));
    start = end + 1;
  }
  return tokens;
}

/** Ranks of one room grouped by destination, in order of each destination's first rank. */
export function groupRoomByDestination(
  room: WaterfallSlotDestination[],
): Array<{ destination: string; ranks: number[] }> {
  const groups = new Map<string, number[]>();
  room.forEach((destination, index) => {
    if (destination === null) return;
    groups.set(destination, [...(groups.get(destination) ?? []), index + 1]);
  });
  return [...groups].map(([destination, ranks]) => ({ destination, ranks }));
}

/** Like `groupRoomByDestination`, with the ranks that are out grouped as 'eliminated' (last). */
export function groupRoomWithOut(
  room: WaterfallSlotDestination[],
): Array<{ destination: string; ranks: number[] }> {
  const groups = groupRoomByDestination(room);
  const out = room.flatMap((destination, index) => (destination === null ? [index + 1] : []));
  return out.length > 0 ? [...groups, { destination: ELIMINATED, ranks: out }] : groups;
}

/** Writes a draft back out as ROUNDS:/ROUTES: text. Out slots, and rooms that route nothing, are left out. */
export function serializeWaterfallDraft(draft: WaterfallDraft): string {
  if (draft.rounds.length === 0) return '';
  const roundLines = draft.rounds.map((round) => {
    const size = round.roomCount > 1 ? `${round.roomCount}x${round.roomSize}` : String(round.roomSize);
    return `${round.label} = ${size}${round.isFinal ? ' FINAL' : ''}`;
  });
  const routeLines = draft.rounds.flatMap((round) =>
    (draft.routes[round.label] ?? []).flatMap((room, roomIndex) => {
      const bands = groupRoomByDestination(room).map(
        ({ destination, ranks }) => `${compressWaterfallRanks(ranks).join(',')}->${destination}`,
      );
      if (bands.length === 0) return [];
      const address =
        round.roomCount > 1 ? `${round.label}.${roomIndexToLetter(roomIndex + 1)}` : round.label;
      return [`${address}: ${bands.join(', ')}`];
    }),
  );
  const qualLines = draft.qualRoutes ? [qualRouteLine(draft.qualRoutes)] : [];
  return `ROUNDS:\n${roundLines.join('\n')}\n\nROUTES:\n${[...qualLines, ...routeLines].join('\n')}`.trimEnd();
}

/** The Qual line: only the ranks sent on are written. An all-eliminated routing still writes a line, so it is never read as "no Qual line". */
function qualRouteLine(qualRoutes: WaterfallSlotDestination[]): string {
  const bands = groupRoomByDestination(qualRoutes.map(storedDestination)).map(
    ({ destination, ranks }) => `${compressWaterfallRanks(ranks).join(',')}->${destination}`,
  );
  return bands.length > 0
    ? `Qual: ${bands.join(', ')}`
    : `Qual: 1-${Math.max(qualRoutes.length, 1)}->${ELIMINATED}`;
}

/**
 * Rebuilds a draft from a running tournament's own `state.rounds`, the live
 * source of truth for a materialized waterfall graph -- not the
 * `settings.waterfallGraph` snapshot, which may be stale or absent
 * (tournaments generated before it existed). `waterfallRoutes`' absolute
 * `state.rounds` indices are resolved back to round labels via each
 * destination round's own `customLabel`.
 */
export function waterfallDraftFromRounds(
  rounds: TournamentRound[],
  options: Pick<WaterfallDraftParseOptions, 'rankCount'> = {},
): WaterfallDraft {
  const labelByIndex = new Map(rounds.map((round, index) => [index, round.customLabel]));
  const waterfallRounds = rounds.filter((round) => round.isWaterfall);
  // A round drawn short (a withdrawal) is shown with the room sizes the graph declared for it.
  const draftRounds: WaterfallDraftRound[] = waterfallRounds.map((round) => {
    const declared = declaredWaterfallRooms(round);
    return {
      label: round.customLabel as string,
      roomCount: declared.length,
      roomSize: declared[0],
      isFinal: round.isFinal,
    };
  });
  const routes: Record<string, WaterfallSlotDestination[][]> = {};
  for (const round of waterfallRounds) {
    routes[round.customLabel as string] = round.isFinal
      ? []
      : (round.waterfallRoutes ?? []).map((room) =>
          room.map((destination) =>
            destination === ELIMINATED ? null : (labelByIndex.get(destination) ?? null),
          ),
        );
  }
  const draft: WaterfallDraft = { rounds: draftRounds, routes, qualRoutes: null };
  if (!rounds.some((round) => round.isQual)) return draft;
  const standingsRoutes = rounds.find((round) => round.standingsRoutes)?.standingsRoutes;
  const routed: WaterfallSlotDestination[] = standingsRoutes
    ? standingsRoutes.map((destination) =>
        destination === ELIMINATED ? null : (labelByIndex.get(destination) ?? null),
      )
    : legacyQualRoutes(draft);
  const highest = highestRoutedQualRank(routed);
  const shown = Math.max(highest, options.rankCount ?? highest, 1);
  return { ...draft, qualRoutes: Array.from({ length: shown }, (_, index) => routed[index] ?? null) };
}

/** A qualification-table tournament generated before the Qual source existed: every rank it advanced went to the entry round. */
function legacyQualRoutes(draft: WaterfallDraft): WaterfallSlotDestination[] {
  const entry = findWaterfallRound(
    draft,
    waterfallRoundIntake({ ...draft, qualRoutes: null }).startingRound ?? '',
  );
  return entry ? Array.from({ length: entry.roomCount * entry.roomSize }, () => entry.label) : [];
}

export interface WaterfallFlowEdge {
  from: string;
  /** A round label, or 'eliminated'. */
  to: string;
  players: number;
  /** Ranks going along this edge, per 0-based room index. */
  ranksByRoom: Record<number, number[]>;
}

/** Every from-to hop in the draft with how many players take it, in round order. */
export function waterfallFlowEdges(draft: WaterfallDraft): WaterfallFlowEdge[] {
  const edges: WaterfallFlowEdge[] = [];
  const qualGroups = draft.qualRoutes ? groupRoomByDestination(draft.qualRoutes.map(storedDestination)) : [];
  for (const { destination, ranks } of qualGroups) {
    edges.push({ from: QUAL_LABEL, to: destination, players: ranks.length, ranksByRoom: { 0: ranks } });
  }
  for (const round of draft.rounds) {
    (draft.routes[round.label] ?? []).forEach((room, roomIndex) => {
      for (const { destination, ranks } of groupRoomWithOut(room)) {
        let edge = edges.find((candidate) => candidate.from === round.label && candidate.to === destination);
        if (!edge) {
          edge = { from: round.label, to: destination, players: 0, ranksByRoom: {} };
          edges.push(edge);
        }
        edge.players += ranks.length;
        edge.ranksByRoom[roomIndex] = ranks;
      }
    });
  }
  return edges;
}

export interface WaterfallIntake {
  /** Players routed into each round so far, by label. */
  incoming: Record<string, number>;
  /** The one round nothing routes into, or null when there are none or several (always null with a Qual source: Qual is the source). */
  startingRound: string | null;
  /** Play order when the routing has no loops, otherwise the order rounds were added. */
  order: string[];
}

export function waterfallRoundIntake(draft: WaterfallDraft): WaterfallIntake {
  const labels = draft.rounds.map((round) => round.label);
  const incoming: Record<string, number> = Object.fromEntries(labels.map((label) => [label, 0]));
  const hops = waterfallFlowEdges(draft).filter((edge) => edge.to !== ELIMINATED && edge.to !== edge.from);
  for (const edge of hops) incoming[edge.to] += edge.players;

  const remaining = new Map(labels.map((label) => [label, hops.filter((edge) => edge.to === label).length]));
  // A Qual source feeds its destinations before any round is played.
  for (const edge of hops) {
    if (edge.from === QUAL_LABEL) remaining.set(edge.to, (remaining.get(edge.to) ?? 0) - 1);
  }
  const sources = labels.filter((label) => remaining.get(label) === 0);
  const order: string[] = [];
  const queue = [...sources];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const edge of hops.filter((candidate) => candidate.from === current)) {
      const left = (remaining.get(edge.to) ?? 0) - 1;
      remaining.set(edge.to, left);
      if (left === 0) queue.push(edge.to);
    }
  }

  return {
    incoming,
    startingRound: !draft.qualRoutes && sources.length === 1 ? sources[0] : null,
    order: order.length === labels.length ? order : labels,
  };
}

/** A new draft: an entry round and a Final, every rank out. Rooms are sized to fit the entrants when they divide evenly. */
export function blankWaterfallDraft(
  entrantCount: number | null,
  roomSize: RoomSize,
  options: Pick<WaterfallDraftParseOptions, 'standingsSource'> = {},
): WaterfallDraft {
  const fits = entrantCount !== null && entrantCount > 0 && entrantCount % roomSize.ideal === 0;
  const rounds: WaterfallDraftRound[] = [
    {
      label: 'R1',
      roomCount: fits ? Math.min(entrantCount / roomSize.ideal, MAX_ROOMS_PER_ROUND) : 1,
      roomSize: roomSize.ideal,
      isFinal: false,
    },
    { label: 'Final', roomCount: 1, roomSize: roomSize.ideal, isFinal: true },
  ];
  const qualRoutes = options.standingsSource
    ? Array.from({ length: entrantCount ?? roomSize.max }, (): WaterfallSlotDestination => null)
    : null;
  return { rounds, routes: reshapeRoutes(rounds, {}), qualRoutes };
}

/** Adds a 1-room round, before the Final when the last round is one. */
export function addWaterfallRound(draft: WaterfallDraft, roomSize: number): WaterfallDraft {
  let number = draft.rounds.length + 1;
  while (labelIsTaken(draft, `R${number}`)) number += 1;
  const added: WaterfallDraftRound = { label: `R${number}`, roomCount: 1, roomSize, isFinal: false };
  const last = draft.rounds[draft.rounds.length - 1];
  const rounds = last?.isFinal ? [...draft.rounds.slice(0, -1), added, last] : [...draft.rounds, added];
  return { ...draft, rounds, routes: reshapeRoutes(rounds, draft.routes) };
}

/** Removes a round; any slot that pointed at it becomes out. */
export function removeWaterfallRound(draft: WaterfallDraft, label: string): WaterfallDraft {
  const rounds = draft.rounds.filter((round) => round.label !== label);
  const routes = reshapeRoutes(rounds, draft.routes);
  for (const room of Object.values(routes).flat()) {
    room.forEach((destination, index) => {
      if (destination === label) room[index] = null;
    });
  }
  return { rounds, routes, qualRoutes: unsetQualRoutesTo(draft.qualRoutes, label) };
}

function unsetQualRoutesTo(
  qualRoutes: WaterfallSlotDestination[] | null,
  label: string,
): WaterfallSlotDestination[] | null {
  return qualRoutes?.map((destination) => (destination === label ? null : destination)) ?? null;
}

export function renameWaterfallRound(
  draft: WaterfallDraft,
  from: string,
  requestedName: string,
): WaterfallParseResult<WaterfallDraft> {
  const to = normalizeRoundLabel(requestedName);
  if (!LABEL_PATTERN.test(to)) {
    return err(
      'Round names can use letters, digits, spaces and dashes, and must start and end with a letter or digit.',
    );
  }
  if (to.toLowerCase() === ELIMINATED) return err(`"${ELIMINATED}" is reserved and can't be a round name.`);
  if (to.toLowerCase() === QUAL_LABEL.toLowerCase()) {
    return err(`"${QUAL_LABEL}" stands for the qualification table and can't be a round name.`);
  }
  const clash = draft.rounds.some(
    (round) => round.label !== from && round.label.toLowerCase() === to.toLowerCase(),
  );
  if (clash) return err('Another round already uses that name.');
  const rounds = draft.rounds.map((round) => (round.label === from ? { ...round, label: to } : round));
  const routes: Record<string, WaterfallSlotDestination[][]> = {};
  for (const round of rounds) {
    const previousLabel = round.label === to ? from : round.label;
    routes[round.label] = (draft.routes[previousLabel] ?? []).map((room) =>
      room.map((destination) => (destination === from ? to : destination)),
    );
  }
  const qualRoutes =
    draft.qualRoutes?.map((destination) => (destination === from ? to : destination)) ?? null;
  return ok({ rounds, routes, qualRoutes });
}

/** Changes a round's room count and size, keeping every slot that still exists. */
export function resizeWaterfallRound(
  draft: WaterfallDraft,
  label: string,
  roomCount: number,
  roomSize: number,
): WaterfallDraft {
  const rounds = draft.rounds.map((round) =>
    round.label === label
      ? {
          ...round,
          roomCount: Math.min(Math.max(Math.trunc(roomCount) || 1, 1), MAX_ROOMS_PER_ROUND),
          roomSize: Math.min(Math.max(Math.trunc(roomSize) || 1, 1), MAX_WATERFALL_ROOM_SIZE),
        }
      : round,
  );
  return { ...draft, rounds, routes: reshapeRoutes(rounds, draft.routes) };
}

/** Marks one round as the Final (clearing the flag elsewhere), or clears it. A round that becomes the Final loses its outgoing routes. */
export function setWaterfallFinal(draft: WaterfallDraft, label: string, isFinal: boolean): WaterfallDraft {
  const rounds = draft.rounds.map((round) => ({
    ...round,
    isFinal: round.label === label ? isFinal : isFinal ? false : round.isFinal,
  }));
  return { ...draft, rounds, routes: reshapeRoutes(rounds, draft.routes) };
}

/**
 * Sends the given slots of one round to a destination (a declared round other
 * than itself, or 'eliminated' / null for out). An unusable destination
 * leaves the draft as it was. The label `Qual` addresses the qualification
 * table: its slots are `{ room: 0, rank }`.
 */
export function assignWaterfallSlots(
  draft: WaterfallDraft,
  label: string,
  slots: WaterfallSlot[],
  destination: WaterfallSlotDestination,
): WaterfallDraft {
  if (label === QUAL_LABEL) return assignQualSlots(draft, slots, destination);
  const round = findWaterfallRound(draft, label);
  const validDestination =
    destination === null ||
    destination === ELIMINATED ||
    (destination !== label && findWaterfallRound(draft, destination) !== undefined);
  if (!round || round.isFinal || !validDestination) return draft;
  const routes = { ...draft.routes, [label]: draft.routes[label].map((room) => [...room]) };
  for (const { room, rank } of slots) {
    if (room >= 0 && room < round.roomCount && rank >= 1 && rank <= round.roomSize) {
      routes[label][room][rank - 1] = storedDestination(destination);
    }
  }
  return { ...draft, routes };
}

function assignQualSlots(
  draft: WaterfallDraft,
  slots: WaterfallSlot[],
  destination: WaterfallSlotDestination,
): WaterfallDraft {
  const validDestination =
    destination === null ||
    destination === ELIMINATED ||
    findWaterfallRound(draft, destination) !== undefined;
  if (!draft.qualRoutes || !validDestination) return draft;
  const stored = storedDestination(destination);
  const qualRoutes = [...draft.qualRoutes];
  for (const { rank } of slots) {
    if (rank >= 1 && rank <= qualRoutes.length) qualRoutes[rank - 1] = stored;
  }
  return { ...draft, qualRoutes };
}
