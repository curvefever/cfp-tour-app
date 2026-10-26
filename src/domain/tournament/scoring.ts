import { getGameFormat } from './formats';
import { buildTeamMap } from './roster';
import { currentColumn } from './round-columns';
import type { ScoringSystemKey, TeamScoringRuleKey, TournamentRound, TournamentState } from './types';

export function scoreOrDefault(
  raw: string | number | null | undefined,
  fallback: number | null,
): number | null {
  return raw !== null && raw !== undefined && raw !== '' ? Number.parseInt(String(raw), 10) : fallback;
}

function computeTeamScore(individualScores: number[], rule: TeamScoringRuleKey, designatedIndex = 0): number {
  return rule === 'designated-player'
    ? individualScores[designatedIndex] || 0
    : individualScores.reduce((total, score) => total + score, 0);
}

export function getDefenderIndex(
  state: Pick<TournamentState, 'defenderChanges'>,
  teamId: string | undefined,
  roundIndex: number,
): number {
  const changes = teamId ? (state.defenderChanges[teamId] ?? []) : [];
  let bestIndex = 0;
  let bestRound = -1;
  for (const change of changes) {
    if (change.round <= roundIndex && change.round > bestRound) {
      bestRound = change.round;
      bestIndex = change.memberIdx;
    }
  }
  return bestIndex;
}

/** Per-member score keys a unit has: the team size, or `undefined` when a unit takes one score (individual format, Survival Teams). */
export function scoredTeamSize(
  state: Pick<TournamentState, 'gameFormat' | 'gamemodeConfig'>,
): number | undefined {
  if (state.gamemodeConfig.teamScoringRule === 'survival-teams') return undefined;
  return getGameFormat(state.gameFormat)?.teamSize;
}

function getUnitScoreForGame(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  game: number | null,
  fallback: number | null,
): number | null {
  const teamSize = scoredTeamSize(state);
  const gamePart = game === null ? '' : `-g${game}`;
  if (!teamSize) {
    return scoreOrDefault(state.scores[`r${roundIndex}-rm${room}-p${position}${gamePart}`], fallback);
  }

  const roomAssignments = (state.assignments[roundIndex] ?? []).filter(
    (assignment) => assignment.room === room,
  );
  const team = roomAssignments[position] ? buildTeamMap(state)[roomAssignments[position].name] : undefined;
  const values: number[] = [];
  let anyMissing = false;
  for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
    if (!team?.members?.[memberIndex]) {
      values.push(0);
      continue;
    }
    let value = scoreOrDefault(
      state.scores[`r${roundIndex}-rm${room}-p${position}${gamePart}-m${memberIndex}`],
      null,
    );
    if (value === null) {
      anyMissing = true;
      value = 0;
    }
    values.push(value);
  }
  if (anyMissing && fallback === null) return null;
  const rule = state.gamemodeConfig.teamScoringRule ?? 'sum-members';
  return computeTeamScore(values, rule, getDefenderIndex(state, team?.teamId, roundIndex));
}

/** The rooms (1-based) of a round that have units, in order. */
export function occupiedRooms(state: Pick<TournamentState, 'assignments'>, roundIndex: number): number[] {
  const assignments = state.assignments[roundIndex] ?? [];
  return [...new Set(assignments.flatMap((entry) => (entry.room === null ? [] : [entry.room])))].sort(
    (first, second) => first - second,
  );
}

/** Whether every unit of the room has a score (every game, in a round of several games). */
export function isRoomScored(state: TournamentState, roundIndex: number, room: number): boolean {
  return (state.assignments[roundIndex] ?? [])
    .filter((entry) => entry.room === room)
    .every((_, position) => getUnitScore(state, roundIndex, room, position, null) !== null);
}

export function getUnitScore(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  fallback: number | null,
): number | null {
  const round = state.rounds[roundIndex];
  const games = round?.numGames && round.numGames > 1 ? round.numGames : 1;
  if (games === 1) {
    return getUnitScoreForGame(state, roundIndex, room, position, null, fallback);
  }
  let total = 0;
  let anyMissing = false;
  for (let game = 1; game <= games; game += 1) {
    let value = getUnitScoreForGame(state, roundIndex, room, position, game, null);
    if (value === null) {
      anyMissing = true;
      value = 0;
    }
    total += value;
  }
  return anyMissing && fallback === null ? null : total;
}

/** The Final's score key for one game of a unit (a player, a team id, or an anonymous alias), and for one member of a team. */
export function finalScoreKey(game: number, key: string, memberIndex?: number): string {
  return `game${game}-${key}` + (memberIndex === undefined ? '' : `-m${memberIndex}`);
}

export function getFinalUnitScore(
  state: TournamentState,
  key: string,
  game: number,
  fallback: number | null,
): number | null {
  const teamSize = scoredTeamSize(state);
  if (!teamSize) {
    return scoreOrDefault(state.finalScores[finalScoreKey(game, key)], fallback);
  }
  const team = buildTeamMap(state)[key];
  const values: number[] = [];
  let anyMissing = false;
  for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
    if (!team?.members?.[memberIndex]) {
      values.push(0);
      continue;
    }
    const value = scoreOrDefault(state.finalScores[finalScoreKey(game, key, memberIndex)], null);
    values.push(value ?? 0);
    if (value === null) anyMissing = true;
  }
  if (anyMissing && fallback === null) return null;
  const rule = state.gamemodeConfig.teamScoringRule ?? 'sum-members';
  const finalRoundIndex = state.rounds.findIndex((round) => round.isFinal);
  return computeTeamScore(values, rule, getDefenderIndex(state, key, finalRoundIndex));
}

export function scoreKeysForPosition(options: {
  roundIndex: number;
  room: number;
  position: number;
  numGames?: number;
  teamSize?: number;
}): string[] {
  const { roundIndex, room, position, numGames = 1, teamSize } = options;
  const keys: string[] = [];
  for (let game = 1; game <= numGames; game += 1) {
    const base = `r${roundIndex}-rm${room}-p${position}` + (numGames > 1 ? `-g${game}` : '');
    if (teamSize) {
      for (let member = 0; member < teamSize; member += 1) {
        keys.push(`${base}-m${member}`);
      }
    } else {
      keys.push(base);
    }
  }
  return keys;
}

/**
 * Standard points for one counted round: 1st place earns the tournament's largest room size, minus one per
 * place (floored at 0). The same place earns the same points whatever the size of the room it was played in.
 */
export function standardPoints(place: number, maxRoomSize: number): number {
  return Math.max(0, maxRoomSize + 1 - place);
}

/** Standard tables for the largest rooms; smaller formats keep maxRoomSize…1. */
const LARGE_ROOM_STANDARD_TABLES: Record<number, readonly number[]> = {
  10: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  9: [10, 8, 7, 6, 5, 4, 3, 2, 1],
  8: [10, 8, 6, 5, 4, 3, 2, 1],
};

/** The Standard table of a format whose largest room is `maxRoomSize`, 1st first. */
export function standardPointsTable(maxRoomSize: number): number[] {
  return [
    ...(LARGE_ROOM_STANDARD_TABLES[maxRoomSize] ??
      Array.from({ length: maxRoomSize }, (_, index) => standardPoints(index + 1, maxRoomSize))),
  ];
}

/**
 * The points of each place in a room of `roomSize` units, 1st first, from a table for rooms of `maxRoomSize`.
 * The largest room reads the table as it is. A smaller room reads it at its share of opponents beaten: place p
 * sits at position 1 + (maxRoomSize − 1)(p − 1)/(roomSize − 1), interpolated linearly and rounded to the
 * nearest half point (half up), so 1st and last always earn the table's first and last entries. Integer
 * arithmetic keeps the rounding exact. A lone unit earns the first entry.
 */
export function scaledRoomPoints(table: readonly number[], maxRoomSize: number, roomSize: number): number[] {
  const used = table.slice(0, maxRoomSize);
  if (roomSize >= maxRoomSize) return used;
  if (roomSize < 2) return used.slice(0, Math.max(roomSize, 0));
  const gaps = roomSize - 1;
  return Array.from({ length: roomSize }, (_, index) => {
    const steps = (maxRoomSize - 1) * index;
    const lower = Math.floor(steps / gaps);
    const rest = steps - lower * gaps;
    const from = used[lower] ?? 0;
    const scaledByGaps = from * gaps + ((used[lower + 1] ?? 0) - from) * rest;
    return Math.floor((4 * scaledByGaps + gaps) / (2 * gaps)) / 2;
  });
}

/** Organiser-supplied rank->points table lookup (1-indexed rank, highest rank first). A rank beyond the table's own length (shouldn't happen given generation.ts's validation) falls back to 0. */
export function positionalPoints(rank: number, table: readonly number[]): number {
  return table[rank - 1] ?? 0;
}

/** How Setup and the Admin recap name each scoring system (players only ever see "Points"). */
export const SCORING_SYSTEM_OPTION_LABELS: Record<ScoringSystemKey, string> = {
  fairpoints: 'Standard points (1st = largest room size, −1 per place)',
  'positional-points': 'Custom points table',
};

/** Points as shown: whole numbers stay whole, a shared place's fractional average shows one decimal ("6.5", "6.3" for 6.333…). */
export function formatStandingValue(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function groupByScore<T extends { score: number }>(scoredDescending: T[]): T[][] {
  const clusters: T[][] = [];
  let index = 0;
  while (index < scoredDescending.length) {
    let end = index;
    while (
      end + 1 < scoredDescending.length &&
      scoredDescending[end + 1].score === scoredDescending[index].score
    ) {
      end += 1;
    }
    clusters.push(scoredDescending.slice(index, end + 1));
    index = end + 1;
  }
  return clusters;
}

/** Stored in a tie's list between the ranked picks and the units that share the next place ("#" can't occur in a unit name). */
export const SHARED_TIE_MARK = '#shared';

/** A tie's stored decision: the units picked to rank next, in order, and the units that share the next place (empty unless shared). */
export function readTieResolution(
  state: Pick<TournamentState, 'tieResolutions'>,
  key: string,
): { ranked: string[]; shared: string[] } {
  const value = state.tieResolutions[key];
  if (!value) return { ranked: [], shared: [] };
  const list = Array.isArray(value) ? value : [value];
  const markAt = list.indexOf(SHARED_TIE_MARK);
  if (markAt < 0) return { ranked: list, shared: [] };
  return { ranked: list.slice(0, markAt), shared: list.slice(markAt + 1) };
}

/** The units picked to rank next, in order (a shared group is not part of it). */
export function tieResolutionList(state: Pick<TournamentState, 'tieResolutions'>, key: string): string[] {
  return readTieResolution(state, key).ranked;
}

/** One unit of a room with the place it holds; `sharedBy` is 1 when alone, else how many units share `place`. */
export interface RoomPlace<T> {
  entry: T;
  place: number;
  sharedBy: number;
}

/** A room's units best first, each with its place: ranked picks first, then the units sharing the next place, then the rest of a tie in their order. */
export function orderRoomWithPlaces<T extends { name: string; score: number }>(
  scored: T[],
  roundIndex: number,
  room: number,
  state: Pick<TournamentState, 'tieResolutions'>,
): Array<RoomPlace<T>> {
  const sorted = [...scored].sort((first, second) => second.score - first.score);
  const placed: Array<RoomPlace<T>> = [];
  for (const cluster of groupByScore(sorted)) {
    if (cluster.length < 2) {
      placed.push({ entry: cluster[0], place: placed.length + 1, sharedBy: 1 });
      continue;
    }
    const key = `r${roundIndex}-rm${room}-s${cluster[0].score}`;
    const { ranked, shared } = readTieResolution(state, key);
    const byName = new Map(cluster.map((entry) => [entry.name, entry]));
    const rankedNames = ranked.filter((name) => byName.has(name));
    const sharedNames = shared.filter((name) => byName.has(name) && !rankedNames.includes(name));
    const sharingNames = sharedNames.length >= 2 ? sharedNames : [];
    const taken = new Set([...rankedNames, ...sharingNames]);
    const remaining = cluster.map((entry) => entry.name).filter((name) => !taken.has(name));
    for (const name of rankedNames) {
      placed.push({ entry: byName.get(name) as T, place: placed.length + 1, sharedBy: 1 });
    }
    const sharedPlace = placed.length + 1;
    for (const name of sharingNames) {
      placed.push({ entry: byName.get(name) as T, place: sharedPlace, sharedBy: sharingNames.length });
    }
    for (const name of remaining) {
      placed.push({ entry: byName.get(name) as T, place: placed.length + 1, sharedBy: 1 });
    }
  }
  return placed;
}

export function orderRoomByScore<T extends { name: string; score: number }>(
  scored: T[],
  roundIndex: number,
  room: number,
  state: Pick<TournamentState, 'tieResolutions'>,
): T[] {
  return orderRoomWithPlaces(scored, roundIndex, room, state).map((item) => item.entry);
}

/** The Final scores under `finalScores` (game{n}-{name} keys, no round index); every other round under `scores` (r{roundIndex}-... keys). */
export function roundHasAnyScore(
  state: Pick<TournamentState, 'scores' | 'finalScores'>,
  roundIndex: number,
  round: TournamentRound,
): boolean {
  if (round.isFinal) {
    return Object.values(state.finalScores).some((value) => value !== null && value !== '');
  }
  const prefix = `r${roundIndex}-`;
  return Object.entries(state.scores).some(([key, value]) => key.startsWith(prefix) && value !== null);
}

/** A room of the column in play with no score entered yet. */
export interface UnscoredRoom {
  roundIndex: number;
  room: number;
}

/**
 * The rooms of the column in play that hold two or more units and have no score entered at all (any game of
 * any unit counts as a score). A room of one unit routes uncontested and never counts; the Final ends with
 * Finish, not Next Round, so it is left out.
 */
export function unscoredRooms(state: TournamentState): UnscoredRoom[] {
  const { start, end } = currentColumn(state);
  const unscored: UnscoredRoom[] = [];
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    if (state.rounds[roundIndex]?.isFinal) continue;
    const sizes = new Map<number, number>();
    for (const entry of state.assignments[roundIndex] ?? []) {
      if (entry.room !== null) sizes.set(entry.room, (sizes.get(entry.room) ?? 0) + 1);
    }
    for (const [room, size] of [...sizes].sort((first, second) => first[0] - second[0])) {
      const prefix = `r${roundIndex}-rm${room}-`;
      const scored = Object.entries(state.scores).some(
        ([key, value]) => key.startsWith(prefix) && value !== null,
      );
      if (size >= 2 && !scored) unscored.push({ roundIndex, room });
    }
  }
  return unscored;
}
