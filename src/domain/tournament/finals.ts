import { getFinalUnitScore } from './scoring';
import type { TournamentRound, TournamentState } from './types';

interface GrandFinalRaceState {
  wbName: string;
  lbName: string;
  wbWins: number;
  lbWins: number;
  wbTarget: number;
  lbTarget: number;
  gamesPlayed: number;
  decided: boolean;
  winnerName: string | null;
}

interface FinalsUnitProgress {
  name: string;
  perGame: Array<number | null>;
  total: number;
  wins: number;
}

interface FinalsProgressState {
  isGrandFinal: boolean;
  numGames: number;
  units: FinalsUnitProgress[];
  gameComplete: boolean[];
  nextGame: number | null;
  complete: boolean;
  order: Array<string | null>;
  race: GrandFinalRaceState | null;
}

export function computeGrandFinalRaceState(
  state: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): GrandFinalRaceState | null {
  const assignments = state.assignments[roundIndex] ?? [];
  if (assignments.length !== 2 || round.wbFinalistName == null) return null;
  const wbName = round.wbFinalistName;
  const lbName = assignments[0].name === wbName ? assignments[1].name : assignments[0].name;
  const wbTarget = state.gamemodeConfig.grandFinalWbTarget || 2;
  const lbTarget = state.gamemodeConfig.grandFinalLbTarget || 3;
  let wbWins = 0;
  let lbWins = 0;
  let gamesPlayed = 0;
  let winnerName: string | null = null;
  for (let game = 1; game <= (round.numGames ?? 0); game += 1) {
    const wbScore = getFinalUnitScore(state, wbName, game, null);
    const lbScore = getFinalUnitScore(state, lbName, game, null);
    if (wbScore === null || lbScore === null) break;
    gamesPlayed = game;
    if (wbScore > lbScore) wbWins += 1;
    else if (lbScore > wbScore) lbWins += 1;
    if (wbWins >= wbTarget) {
      winnerName = wbName;
      break;
    }
    if (lbWins >= lbTarget) {
      winnerName = lbName;
      break;
    }
  }
  return {
    wbName,
    lbName,
    wbWins,
    lbWins,
    wbTarget,
    lbTarget,
    gamesPlayed,
    decided: winnerName !== null,
    winnerName,
  };
}

interface GrandFinalRaceTransition {
  state: TournamentState;
  /** Matches legacy checkGrandFinalRace(): skip auto-archive while true. */
  inProgress: boolean;
  openedNextGame: boolean;
}

/** Pure state transition counterpart of legacy checkGrandFinalRace(). */
export function progressGrandFinalRace(state: TournamentState): GrandFinalRaceTransition {
  const roundIndex = state.curRound;
  const round = state.rounds[roundIndex];
  if (!round || round.bracket !== 'grand-final') {
    return { state, inProgress: false, openedNextGame: false };
  }
  const race = computeGrandFinalRaceState(state, roundIndex, round);
  if (!race || race.decided) {
    return { state, inProgress: false, openedNextGame: false };
  }
  if (race.gamesPlayed !== (round.numGames ?? 0)) {
    return { state, inProgress: true, openedNextGame: false };
  }
  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex ? { ...entry, numGames: (entry.numGames ?? 0) + 1 } : entry,
  );
  return {
    state: { ...state, rounds },
    inProgress: true,
    openedNextGame: true,
  };
}

/**
 * Whether a plain (non-grand-final) Final round is fully scored, treating an
 * anonymous-flagged game's slot as filled once its placeholder alias has a
 * score -- not the real finalist's own key, which stays empty by design
 * until connectAnonymousFinalist() merges it in. Deliberately NOT the same
 * check as computeRankings()'s finalComplete (rankings.ts), which reads only
 * real keys and would therefore never become true while any game is still
 * anonymous and unconnected -- this is the gate connectAnonymousFinalist()
 * itself needs to decide whether a placeholder is safe to reveal.
 */
export function isPlainFinalFullyScored(
  state: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): boolean {
  const assignments = state.assignments[roundIndex] ?? [];
  const numGames = round.numGames ?? 0;
  if (assignments.length === 0 || numGames === 0) return false;
  const aliasByRealKey = new Map(state.anonymousFinalists.map((entry) => [entry.realKey, entry.alias]));
  return assignments.every((assignment) =>
    Array.from({ length: numGames }, (_, index) => index + 1).every((game) => {
      const key = round.anonymousGames?.includes(game)
        ? (aliasByRealKey.get(assignment.name) ?? assignment.name)
        : assignment.name;
      return getFinalUnitScore(state, key, game, null) !== null;
    }),
  );
}

export function finalsProgressState(
  state: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): FinalsProgressState {
  const assignments = state.assignments[roundIndex] ?? [];
  const numGames = round.numGames ?? 0;
  const race = round.bracket === 'grand-final' ? computeGrandFinalRaceState(state, roundIndex, round) : null;
  const units = assignments.map((assignment): FinalsUnitProgress => {
    const perGame = Array.from({ length: numGames }, (_, index) =>
      getFinalUnitScore(state, assignment.name, index + 1, null),
    );
    const total = Array.from({ length: numGames }, (_, index) =>
      getFinalUnitScore(state, assignment.name, index + 1, 0),
    ).reduce<number>((sum, score) => sum + (score ?? 0), 0);
    let wins = 0;
    if (race) {
      for (let game = 1; game <= race.gamesPlayed; game += 1) {
        const mine = getFinalUnitScore(state, assignment.name, game, null);
        const otherName = assignment.name === race.wbName ? race.lbName : race.wbName;
        const other = getFinalUnitScore(state, otherName, game, null);
        if (mine !== null && other !== null && mine > other) wins += 1;
      }
    }
    return { name: assignment.name, perGame, total, wins };
  });
  const gameComplete = Array.from(
    { length: numGames },
    (_, index) =>
      assignments.length > 0 &&
      assignments.every((assignment) => getFinalUnitScore(state, assignment.name, index + 1, null) !== null),
  );
  const complete = race
    ? race.decided
    : assignments.length > 0 && gameComplete.length > 0 && gameComplete.every(Boolean);
  const incompleteGame = gameComplete.findIndex((value) => !value);
  const nextGame = !complete && incompleteGame >= 0 ? incompleteGame + 1 : null;
  let order: Array<string | null>;
  if (complete && race) {
    const loser = race.winnerName === race.wbName ? race.lbName : race.wbName;
    order = [race.winnerName, loser];
  } else if (complete) {
    order = [...units].sort((first, second) => second.total - first.total).map((unit) => unit.name);
  } else {
    order = assignments.map((assignment) => assignment.name);
  }
  return {
    isGrandFinal: Boolean(race),
    numGames,
    units,
    gameComplete,
    nextGame,
    complete,
    order,
    race,
  };
}

export interface AnonymousFinalistProgress {
  alias: string;
  /** Keyed by game number (matches TournamentRound.anonymousGames), not 0-indexed -- only the flagged games ever have a placeholder score. */
  perGame: Record<number, number | null>;
  connected: boolean;
  /** Only populated once connected -- the whole point is this stays unknown to a reader until then. */
  realKey: string | null;
}

/** The Bracket UI's anonymous-Final card reads this -- a sibling to finalsProgressState, keyed by placeholder alias instead of real finalist name. */
export function anonymousFinalsProgressState(
  state: TournamentState,
  round: TournamentRound,
): AnonymousFinalistProgress[] {
  const anonymousGames = round.anonymousGames ?? [];
  return state.anonymousFinalists.map((finalist): AnonymousFinalistProgress => {
    const perGame: Record<number, number | null> = {};
    for (const game of anonymousGames) {
      perGame[game] = getFinalUnitScore(state, finalist.alias, game, null);
    }
    return {
      alias: finalist.alias,
      perGame,
      connected: finalist.connected,
      realKey: finalist.connected ? finalist.realKey : null,
    };
  });
}
