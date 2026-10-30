/**
 * Changing the match format of a round that is being played (the live "Edit graph"): its `bestOf` and `numGames`
 * are replaced and the scores already typed are read under the new format. Nothing typed is lost: the games stay,
 * only the keys of a round that grows from one game to several move to game 1 (and back).
 */
import { invalidateStaleTieResolutions } from './advancement';
import { occupiedRooms } from './scoring';
import type { TournamentRound, TournamentState } from './types';

type MatchFormat = Pick<TournamentRound, 'bestOf' | 'numGames'>;

/** Whether two rounds play the same match format (a round with no `numGames` plays one game). */
export function sameMatchFormat(first: MatchFormat, second: MatchFormat): boolean {
  return first.bestOf === second.bestOf && (first.numGames ?? 1) === (second.numGames ?? 1);
}

function hasScore(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/** The highest game of the round that holds a score in any room (a key with no game suffix is game 1). */
function highestScoredGame(state: TournamentState, roundIndex: number): number {
  const isFinal = Boolean(state.rounds[roundIndex]?.isFinal);
  const scores = isFinal ? state.finalScores : state.scores;
  const prefix = isFinal ? 'game' : `r${roundIndex}-`;
  let highest = 0;
  for (const [key, value] of Object.entries(scores)) {
    if (!key.startsWith(prefix) || !hasScore(value)) continue;
    const game = isFinal ? /^game(\d+)-/.exec(key) : /-g(\d+)(?:-m\d+)?$/.exec(key);
    highest = Math.max(highest, game ? Number(game[1]) : 1);
  }
  return highest;
}

/** The key a seat's score moves to when a round grows from one game to several, or comes back; null for any other key. */
function movedKey(key: string, roundIndex: number, toSeveral: boolean): string | null {
  const escaped = `r${roundIndex}-rm(\\d+)-p(\\d+)`;
  if (toSeveral) {
    const match = new RegExp(`^${escaped}(-m\\d+)?$`).exec(key);
    return match ? `r${roundIndex}-rm${match[1]}-p${match[2]}-g1${match[3] ?? ''}` : null;
  }
  const match = new RegExp(`^${escaped}-g1(-m\\d+)?$`).exec(key);
  return match ? `r${roundIndex}-rm${match[1]}-p${match[2]}${match[3] ?? ''}` : null;
}

/** Re-keys the entries of a record that `movedKey` moves; `keepMemberKeys` leaves the "-m" keys where they are. */
function moveKeys<T>(
  record: Record<string, T>,
  roundIndex: number,
  toSeveral: boolean,
  keepMemberKeys: boolean,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const moved = keepMemberKeys && /-m\d+$/.test(key) ? null : movedKey(key, roundIndex, toSeveral);
    next[moved ?? key] = value;
  }
  return next;
}

const gamesText = (count: number) => `${count} ${count === 1 ? 'game' : 'games'}`;

/**
 * The state with the round played in `next`'s format, or the reason it can't be: a score already typed for a game
 * the new format doesn't have. Absence answers move with their score keys, and every room's tie decisions are
 * checked again against the order the new format gives.
 */
export function changeRoundMatchFormat(
  state: TournamentState,
  roundIndex: number,
  next: MatchFormat,
): { state: TournamentState } | { error: string } {
  const round = state.rounds[roundIndex];
  const label =
    round.customLabel ?? (round.isFinal ? 'Final' : round.isSemis ? 'Semis' : `Round ${round.roundNum}`);
  const oldGames = round.numGames ?? 1;
  const newGames = next.numGames ?? 1;
  const highest = highestScoredGame(state, roundIndex);
  if (highest > newGames) {
    return {
      error: `Can't save: "${label}" already has scores for game ${highest}, so it can't be played over ${gamesText(newGames)}.`,
    };
  }
  const changed: TournamentRound = { ...round, bestOf: next.bestOf, numGames: next.numGames };
  if (changed.bestOf === undefined) delete changed.bestOf;
  if (changed.numGames === undefined) delete changed.numGames;
  let working: TournamentState = {
    ...state,
    rounds: state.rounds.map((entry, index) => (index === roundIndex ? changed : entry)),
  };
  const grows = oldGames === 1 && newGames > 1;
  const shrinks = oldGames > 1 && newGames === 1;
  if (!round.isFinal && (grows || shrinks)) {
    // A Survival member mark is stored under the round-wide member key, which looks like a one-game member score key.
    const keepMemberKeys = state.gamemodeConfig.teamScoringRule === 'survival-teams';
    working = {
      ...working,
      scores: moveKeys(working.scores, roundIndex, grows, false),
      absences: moveKeys(working.absences, roundIndex, grows, keepMemberKeys),
    };
  }
  if (round.isFinal) return { state: working };
  for (const room of occupiedRooms(working, roundIndex)) {
    working = invalidateStaleTieResolutions(working, roundIndex, room);
  }
  return { state: working };
}
