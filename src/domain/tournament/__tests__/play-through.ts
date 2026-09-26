import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';

/**
 * Shared helpers for the play-through tests (removal sweep, real-size runs):
 * build a tournament, score every room of the current round with distinct
 * values, and advance with the real transition code, optionally removing one
 * unit along the way.
 */

type SetupOverrides = Parameters<typeof createDefaultSetup>[0];

export interface SweepConfig {
  label: string;
  count: number;
  setup: SetupOverrides;
  teams: boolean;
}

export function buildState(config: SweepConfig): TournamentState | null {
  const players = config.teams
    ? Array.from({ length: config.count }, (_, index): TournamentTeam => ({
        teamId: `t${index + 1}`,
        teamName: `Team ${index + 1}`,
        members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
      }))
    : Array.from({ length: config.count }, (_, index) => `P${index + 1}`);
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: config.count, players }),
    createDefaultSetup({ qualAdv: '8', ...config.setup }),
    createTournamentRuntime(),
  );
  // A config the generator itself refuses (e.g. an oversized Final) isn't part of the sweep.
  return result.status === 'generated' ? result.state : null;
}

/** Scores every occupied room of the current round; every score is globally distinct. */
export function scoreCurrentRound(state: TournamentState, teamSize: number): TournamentState {
  const round = state.rounds[state.curRound];
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  let counter = 0;
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    counter += 1;
    const keys = scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: teamSize || undefined,
    });
    // The first key carries the distinct part, any others a constant, so team
    // totals stay distinct too.
    keys.forEach((key, index) => {
      scores[key] = index === 0 ? 1000 - 10 * counter - state.curRound : 1;
    });
  }
  return { ...state, scores };
}

export type Outcome =
  { kind: 'ok' } | { kind: 'blocked'; reason: string; message: string } | { kind: 'threw'; message: string };

/** Advances to the Final (or the end of what can be advanced), removing one unit at `removeAt` if given. */
export function playThrough(
  start: TournamentState,
  teamSize: number,
  removeAt: 'first' | 'elimination' | null,
): Outcome {
  let state = start;
  let removed = removeAt === null;
  try {
    for (let guard = 0; guard < 30; guard += 1) {
      const round = state.rounds[state.curRound];
      const isFirstElimination = !round.isNoElim && !round.isQual && !round.isSwiss && !round.isFinal;
      const removalDue = removeAt === 'first' ? state.curRound === 0 : isFirstElimination;
      if (!removed && removalDue) {
        const victim = (state.assignments[state.curRound] ?? []).find((entry) => entry.room !== null);
        if (victim) state = removeRosterUnit(state, victim.name);
        removed = true;
      }
      if (round.isFinal) return { kind: 'ok' };
      const result = advanceTournamentRound(scoreCurrentRound(state, teamSize));
      if (result.status === 'blocked')
        return { kind: 'blocked', reason: result.reason, message: result.message };
      if (result.status === 'noop') return { kind: 'ok' };
      state = result.state;
    }
    return { kind: 'threw', message: 'did not finish within 30 rounds' };
  } catch (error) {
    return { kind: 'threw', message: error instanceof Error ? error.message : String(error) };
  }
}

export interface RemovalPlay {
  outcome: Outcome;
  /** The state when play stopped: on the Final if it got there, else the round that blocked. */
  state: TournamentState;
}

/**
 * Plays to the Final (or the end of what can be advanced), removing one unit
 * on arrival at each round index listed in `removalRounds` (a repeated index
 * removes that many units from the same round). `victimFor` picks the unit,
 * by default the first one seated in a room.
 */
export function playWithRemovals(
  start: TournamentState,
  teamSize: number,
  removalRounds: number[],
  victimFor: (state: TournamentState) => string | undefined = firstSeatedUnit,
): RemovalPlay {
  let state = start;
  const pending = [...removalRounds];
  try {
    for (let guard = 0; guard < 40; guard += 1) {
      while (pending.includes(state.curRound)) {
        pending.splice(pending.indexOf(state.curRound), 1);
        const victim = victimFor(state);
        if (victim !== undefined) state = removeRosterUnit(state, victim);
      }
      if (state.rounds[state.curRound].isFinal) return { outcome: { kind: 'ok' }, state };
      const result = advanceTournamentRound(scoreCurrentRound(state, teamSize));
      if (result.status === 'blocked') {
        return { outcome: { kind: 'blocked', reason: result.reason, message: result.message }, state };
      }
      if (result.status === 'noop') return { outcome: { kind: 'ok' }, state };
      state = result.state;
    }
    return { outcome: { kind: 'threw', message: 'did not finish within 40 rounds' }, state };
  } catch (error) {
    return {
      outcome: { kind: 'threw', message: error instanceof Error ? error.message : String(error) },
      state,
    };
  }
}

export function firstSeatedUnit(state: TournamentState): string | undefined {
  return (state.assignments[state.curRound] ?? []).find((entry) => entry.room !== null)?.name;
}
