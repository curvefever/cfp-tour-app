import { getGameFormat } from './formats';
import { buildTeamMap } from './roster';
import type { ScoringSystemKey, TeamScoringRuleKey, TournamentRound, TournamentState } from './types';

function scoreOrDefault(raw: string | number | null | undefined, fallback: number | null): number | null {
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

export function getFinalUnitScore(
  state: TournamentState,
  key: string,
  game: number,
  fallback: number | null,
): number | null {
  const teamSize = scoredTeamSize(state);
  const gamePart = `game${game}`;
  if (!teamSize) {
    return scoreOrDefault(state.finalScores[`${gamePart}-${key}`], fallback);
  }
  const team = buildTeamMap(state)[key];
  const values: number[] = [];
  let anyMissing = false;
  for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
    if (!team?.members?.[memberIndex]) {
      values.push(0);
      continue;
    }
    const value = scoreOrDefault(state.finalScores[`${gamePart}-${key}-m${memberIndex}`], null);
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

/** Organiser-supplied rank->points table lookup (1-indexed rank, highest rank first). A rank beyond the table's own length (shouldn't happen given generation.ts's validation) falls back to 0. */
export function positionalPoints(rank: number, table: readonly number[]): number {
  return table[rank - 1] ?? 0;
}

/** How Setup and the Admin recap name each scoring system (players only ever see "Points"). */
export const SCORING_SYSTEM_OPTION_LABELS: Record<ScoringSystemKey, string> = {
  fairpoints: 'Standard points (1st = largest room size, −1 per place)',
  'positional-points': 'Custom points table',
};

export function formatStandingValue(value: number): string {
  return String(Math.round(value));
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

export function tieResolutionList(state: Pick<TournamentState, 'tieResolutions'>, key: string): string[] {
  const value = state.tieResolutions[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function orderRoomByScore<T extends { name: string; score: number }>(
  scored: T[],
  roundIndex: number,
  room: number,
  state: Pick<TournamentState, 'tieResolutions'>,
): T[] {
  const sorted = [...scored].sort((first, second) => second.score - first.score);
  const ordered: T[] = [];
  for (const cluster of groupByScore(sorted)) {
    if (cluster.length < 2) {
      ordered.push(cluster[0]);
      continue;
    }
    const key = `r${roundIndex}-rm${room}-s${cluster[0].score}`;
    const resolved = tieResolutionList(state, key);
    const byName = new Map(cluster.map((entry) => [entry.name, entry]));
    const remaining = cluster.map((entry) => entry.name).filter((name) => !resolved.includes(name));
    for (const name of [...resolved, ...remaining]) {
      const entry = byName.get(name);
      if (entry) ordered.push(entry);
    }
  }
  return ordered;
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
