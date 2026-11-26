import { withoutAbsenceAnswer } from './absences';
import { isTieResolved } from './advancement';
import { MAX_ANONYMOUS_FINALISTS, withFinalistAliasesForLineup } from './anonymous-finalists';
import { isPlainFinalFullyScored, progressGrandFinalRace } from './finals';
import { getGameFormat } from './formats';
import { isMatchRound } from './match-format';
import { isPoolingRound } from './pooling';
import { detectTieBreaks, invalidateStaleTieResolutions } from './room-ties';
import { getFinalUnitScore, readTieResolution, SHARED_TIE_MARK } from './scoring';
import type { TournamentState } from './types';

/** What the organiser enters while a round is played: a room or Final score, the anonymous Final's games and the picks on a tie. */

// Scores must be non-negative integers. Rejects (rather than truncates)
// decimals so "5.7" doesn't silently become "5", and rejects negatives --
// 0 is a real, complete score. Number(), not parseInt, so a fractional
// part is actually detected instead of silently dropped by truncation.
function isValidNonNegativeInteger(value: string): boolean {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0;
}

export function setRoundScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
  roundIndex: number,
  room: number,
): TournamentState {
  const raw = value === '' || value === null ? null : String(value);
  const parsed = raw !== null && isValidNonNegativeInteger(raw) ? Number.parseInt(raw, 10) : null;
  let next = {
    ...state,
    scores: { ...state.scores, [key]: parsed },
    // A corrected 0 is asked again, and a score above 0 is no absence.
    ...(state.scores[key] === parsed ? {} : { absences: withoutAbsenceAnswer(state.absences, key) }),
  };
  next = invalidateStaleTieResolutions(next, roundIndex, room);
  return next;
}

export function setFinalScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
): TournamentState {
  const raw = value === '' || value === null ? null : String(value);
  const parsed = raw !== null && isValidNonNegativeInteger(raw) ? Number.parseInt(raw, 10) : '';
  const updated: TournamentState = {
    ...state,
    finalScores: { ...state.finalScores, [key]: parsed },
  };
  return progressGrandFinalRace(updated).state;
}

// Anonymous Finals matches (v1, individual formats only -- a team-format
// alias would need its own fabricated TournamentTeam/member list, since
// getFinalUnitScore's team branch reads real roster data via buildTeamMap()
// that an alias never has; out of scope, guarded below rather than half-built).

function findFinalRoundIndex(state: TournamentState): number {
  return state.rounds.findIndex((round) => round.isFinal);
}

export function flagFinalGameAnonymous(state: TournamentState, gameNumber: number): TournamentState {
  if (getGameFormat(state.gameFormat)?.teamSize) return state;
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  // Grand-final race progression (progressGrandFinalRace) decides whether to
  // open the next game by reading the two real finalists' own keys directly
  // -- an anonymous game's score living under its alias instead would stall
  // the race forever. Out of scope for v1, not a half-built workaround.
  // A Best-of or WINS Final reads its games' scores the same way, by the finalists' real keys.
  if (!round || round.bracket === 'grand-final' || isMatchRound(round)) return state;
  const numGames = round.numGames ?? 0;
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > numGames) return state;
  if (round.anonymousGames?.includes(gameNumber)) return state;
  const assignments = state.assignments[roundIndex] ?? [];
  const alreadyScored = assignments.some(
    (assignment) => getFinalUnitScore(state, assignment.name, gameNumber, null) !== null,
  );
  if (alreadyScored) return state;

  if (assignments.length === 0 || assignments.length > MAX_ANONYMOUS_FINALISTS) return state;

  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex
      ? { ...entry, anonymousGames: [...(entry.anonymousGames ?? []), gameNumber] }
      : entry,
  );
  return withFinalistAliasesForLineup({ ...state, rounds });
}

export function unflagFinalGameAnonymous(state: TournamentState, gameNumber: number): TournamentState {
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  if (!round?.anonymousGames?.includes(gameNumber)) return state;
  const alreadyScored = state.anonymousFinalists.some(
    (finalist) => getFinalUnitScore(state, finalist.alias, gameNumber, null) !== null,
  );
  if (alreadyScored) return state;
  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex
      ? { ...entry, anonymousGames: (entry.anonymousGames ?? []).filter((game) => game !== gameNumber) }
      : entry,
  );
  return { ...state, rounds };
}

export function connectAnonymousFinalist(state: TournamentState, alias: string): TournamentState {
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  if (!round || !isPlainFinalFullyScored(state, roundIndex, round)) return state;
  const finalist = state.anonymousFinalists.find((entry) => entry.alias === alias);
  if (!finalist || finalist.connected) return state;
  const anonymousGames = round.anonymousGames ?? [];
  const finalScores = { ...state.finalScores };
  for (const gameNumber of anonymousGames) {
    const anonKey = `game${gameNumber}-${alias}`;
    const realKey = `game${gameNumber}-${finalist.realKey}`;
    if (finalScores[realKey] == null || finalScores[realKey] === '') {
      finalScores[realKey] = finalScores[anonKey] ?? null;
    }
  }
  const anonymousFinalists = state.anonymousFinalists.map((entry) =>
    entry.alias === alias ? { ...entry, connected: true } : entry,
  );
  return { ...state, finalScores, anonymousFinalists };
}

export function resolveTournamentTie(state: TournamentState, key: string, name: string): TournamentState {
  const { ranked, shared } = readTieResolution(state, key);
  if (shared.length > 0) return state;
  const list = [...ranked];
  if (!list.includes(name)) list.push(name);
  return {
    ...state,
    tieResolutions: { ...state.tieResolutions, [key]: list },
  };
}

/** The room tie behind a tie key (`r{round}-rm{room}-s{score}`) when it is a current tie of a pooling round. */
function poolingRoomTie(state: TournamentState, key: string) {
  const roundIndex = Number(/^r(\d+)-rm\d+-s/u.exec(key)?.[1]);
  const round = state.rounds[roundIndex];
  if (!round || !isPoolingRound(round)) return null;
  return detectTieBreaks(roundIndex, round, state)[key] ?? null;
}

/**
 * Share the points of the places a room tie still covers: `names` must be exactly the tied units not yet ranked
 * (two or more). Stored as the ranked picks, the shared mark, then the sharing units. Pooling rounds only.
 */
export function shareTiedPoints(state: TournamentState, key: string, names: string[]): TournamentState {
  const tie = poolingRoomTie(state, key);
  if (!tie || isTieResolved(key, tie, state)) return state;
  const { ranked } = readTieResolution(state, key);
  const unranked = tie.players.map((player) => player.name).filter((name) => !ranked.includes(name));
  const exact = names.length === unranked.length && unranked.every((name) => names.includes(name));
  if (names.length < 2 || !exact) return state;
  return {
    ...state,
    tieResolutions: { ...state.tieResolutions, [key]: [...ranked, SHARED_TIE_MARK, ...names] },
  };
}
