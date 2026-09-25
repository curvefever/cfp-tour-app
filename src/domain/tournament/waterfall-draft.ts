import type { RoomSize } from './types';
import {
  ELIMINATED,
  LABEL_PATTERN,
  MAX_ROOMS_PER_ROUND,
  expandRankTokens,
  parseWaterfallGraph,
  roomIndexToLetter,
  type WaterfallParseResult,
} from './waterfall-bracket';

/**
 * The waterfall editor's working copy of a graph. `PersistedSetup.waterfallGraph`
 * stays the source of truth (plain ROUNDS:/ROUTES: text); the editor parses it
 * into this shape on every render, changes it with the pure functions below,
 * and writes the text back. Unlike the parser's validated graph, a draft may be
 * unfinished: a slot with no destination yet is `null`.
 *
 * Nothing here re-implements the validation rules. Whether a draft is a
 * complete, consistent graph is still decided by
 * `validateAndOrderWaterfallGraph` on the serialized text, the same call
 * generation makes.
 */

export interface WaterfallDraftRound {
  label: string;
  roomCount: number;
  roomSize: number;
  isFinal: boolean;
}

/** A slot's destination: a round label, the literal 'eliminated', or null while unset. */
export type WaterfallSlotDestination = string | null;

export interface WaterfallDraft {
  rounds: WaterfallDraftRound[];
  /** `routes[label][room][rank - 1]`. Empty for the Final, which routes nowhere. */
  routes: Record<string, WaterfallSlotDestination[][]>;
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

/** Reads ROUNDS:/ROUTES: text into a draft. Empty text is a valid, empty draft. */
export function parseWaterfallDraft(text: string): WaterfallParseResult<WaterfallDraft> {
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
        if (room[rank - 1] !== null) {
          return err(`Round "${round.label}": rank ${rank} is routed more than once.`);
        }
        room[rank - 1] = destination;
      }
    }
  }
  return ok({ rounds, routes });
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

/** Writes a draft back out as ROUNDS:/ROUTES: text. Unset slots (and rooms with none set) are left out. */
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
  return `ROUNDS:\n${roundLines.join('\n')}\n\nROUTES:\n${routeLines.join('\n')}`.trimEnd();
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
  for (const round of draft.rounds) {
    (draft.routes[round.label] ?? []).forEach((room, roomIndex) => {
      for (const { destination, ranks } of groupRoomByDestination(room)) {
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
  /** The one round nothing routes into, or null when there are none or several. */
  startingRound: string | null;
  /** Play order when the routing has no loops, otherwise the order rounds were added. */
  order: string[];
  /** Slots that still have no destination. */
  unsetSlots: number;
}

export function waterfallRoundIntake(draft: WaterfallDraft): WaterfallIntake {
  const labels = draft.rounds.map((round) => round.label);
  const incoming: Record<string, number> = Object.fromEntries(labels.map((label) => [label, 0]));
  const hops = waterfallFlowEdges(draft).filter((edge) => edge.to !== ELIMINATED && edge.to !== edge.from);
  for (const edge of hops) incoming[edge.to] += edge.players;

  const remaining = new Map(labels.map((label) => [label, hops.filter((edge) => edge.to === label).length]));
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

  const unsetSlots = draft.rounds.reduce(
    (sum, round) =>
      sum +
      (draft.routes[round.label] ?? []).reduce(
        (count, room) => count + room.filter((d) => d === null).length,
        0,
      ),
    0,
  );
  return {
    incoming,
    startingRound: sources.length === 1 ? sources[0] : null,
    order: order.length === labels.length ? order : labels,
    unsetSlots,
  };
}

/** A new draft: an entry round and a Final, every rank unset. Rooms are sized to fit the entrants when they divide evenly. */
export function blankWaterfallDraft(entrantCount: number | null, roomSize: RoomSize): WaterfallDraft {
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
  return { rounds, routes: reshapeRoutes(rounds, {}) };
}

/** Adds a 1-room round, before the Final when the last round is one. */
export function addWaterfallRound(draft: WaterfallDraft, roomSize: number): WaterfallDraft {
  let number = draft.rounds.length + 1;
  while (labelIsTaken(draft, `R${number}`)) number += 1;
  const added: WaterfallDraftRound = { label: `R${number}`, roomCount: 1, roomSize, isFinal: false };
  const last = draft.rounds[draft.rounds.length - 1];
  const rounds = last?.isFinal ? [...draft.rounds.slice(0, -1), added, last] : [...draft.rounds, added];
  return { rounds, routes: reshapeRoutes(rounds, draft.routes) };
}

/** Removes a round; any slot that pointed at it becomes unset again. */
export function removeWaterfallRound(draft: WaterfallDraft, label: string): WaterfallDraft {
  const rounds = draft.rounds.filter((round) => round.label !== label);
  const routes = reshapeRoutes(rounds, draft.routes);
  for (const room of Object.values(routes).flat()) {
    room.forEach((destination, index) => {
      if (destination === label) room[index] = null;
    });
  }
  return { rounds, routes };
}

export function renameWaterfallRound(
  draft: WaterfallDraft,
  from: string,
  to: string,
): WaterfallParseResult<WaterfallDraft> {
  if (!LABEL_PATTERN.test(to)) return err('Round names can only use letters and digits.');
  if (to.toLowerCase() === ELIMINATED) return err(`"${ELIMINATED}" is reserved and can't be a round name.`);
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
  return ok({ rounds, routes });
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
  return { rounds, routes: reshapeRoutes(rounds, draft.routes) };
}

/** Marks one round as the Final (clearing the flag elsewhere), or clears it. A round that becomes the Final loses its outgoing routes. */
export function setWaterfallFinal(draft: WaterfallDraft, label: string, isFinal: boolean): WaterfallDraft {
  const rounds = draft.rounds.map((round) => ({
    ...round,
    isFinal: round.label === label ? isFinal : isFinal ? false : round.isFinal,
  }));
  return { rounds, routes: reshapeRoutes(rounds, draft.routes) };
}

/**
 * Sends the given slots of one round to a destination (a declared round other
 * than itself, 'eliminated', or null to unset them). An unusable destination
 * leaves the draft as it was.
 */
export function assignWaterfallSlots(
  draft: WaterfallDraft,
  label: string,
  slots: WaterfallSlot[],
  destination: WaterfallSlotDestination,
): WaterfallDraft {
  const round = findWaterfallRound(draft, label);
  const validDestination =
    destination === null ||
    destination === ELIMINATED ||
    (destination !== label && findWaterfallRound(draft, destination) !== undefined);
  if (!round || round.isFinal || !validDestination) return draft;
  const routes = { ...draft.routes, [label]: draft.routes[label].map((room) => [...room]) };
  for (const { room, rank } of slots) {
    if (room >= 0 && room < round.roomCount && rank >= 1 && rank <= round.roomSize) {
      routes[label][room][rank - 1] = destination;
    }
  }
  return { rounds: draft.rounds, routes };
}
