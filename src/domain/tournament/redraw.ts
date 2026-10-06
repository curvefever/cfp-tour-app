import { roundHasAnyScore } from './scoring';
import { rewindRoomHistory } from './seeding';
import type { TournamentRound, TournamentState } from './types';

/**
 * What "Next Round" does when the round after `roundIndex` is already drawn
 * (the organiser pressed Previous): nothing drawn ahead, re-draw it from the
 * current results, or step forward to it unchanged.
 */
export type DrawnAheadStatus = 'none' | 'redraw' | 'locked';

/**
 * A later drawn round with scores can't be thrown away, and a double
 * elimination or waterfall round that has been advanced from (anything from
 * `roundIndex` up to the one before the last drawn round) already pushed its
 * units into pendingBracketSeeds, which a re-draw can't rebuild; both step
 * forward instead (see docs/rules.md, "Going back a round"). A bracket round
 * that is only drawn, not advanced from, still re-draws: the generic path
 * seeds it and pushes no pending seeds.
 */
export function drawnAheadStatus(state: TournamentState, roundIndex: number): DrawnAheadStatus {
  if (!state.assignments[roundIndex + 1]?.length) return 'none';
  const lastDrawn = lastDrawnIndex(state);
  for (let index = roundIndex; index < lastDrawn; index += 1) {
    if (state.rounds[index]?.bracket || state.rounds[index]?.isWaterfall) return 'locked';
  }
  for (let index = roundIndex + 1; index <= lastDrawn; index += 1) {
    if (!state.assignments[index]?.length) continue;
    if (roundHasAnyScore(state, index, state.rounds[index])) return 'locked';
  }
  return 'redraw';
}

function lastDrawnIndex(state: TournamentState): number {
  for (let index = state.assignments.length - 1; index >= 0; index -= 1) {
    if (state.assignments[index]?.length) return index;
  }
  return -1;
}

/**
 * True when advancing into `round` counted its bye in `poolingByeCounts`: the
 * generic no-elimination branch (selectPoolingBye) and Swiss (swissFoldPair)
 * do; fixed draws and group stages never do (transitions.ts).
 */
function advanceCountedPoolingBye(round: TournamentRound): boolean {
  if (round.fixedRoomAssignments || round.isGroupStage) return false;
  return Boolean(round.isNoElim || round.isSwiss);
}

function undoPoolingByeCounts(counts: Record<string, number>, names: string[]): void {
  for (const name of names) {
    const remaining = (counts[name] ?? 0) - 1;
    if (remaining > 0) counts[name] = remaining;
    else delete counts[name];
  }
}

/**
 * Pure. Throws away every draw after `roundIndex` so the next advance starts
 * from the same bookkeeping as a first advance: the discarded rounds'
 * roomHistory entries, pooling-bye counts, byes, lucky losers and tie
 * resolutions are undone. Highest round first, so each rewind still sees the
 * earlier (also stale) rounds it replays. Round shapes are left alone; the
 * advance re-fits them.
 */
export function discardDrawsAfter(state: TournamentState, roundIndex: number): TournamentState {
  let roomHistory = state.roomHistory;
  const poolingByeCounts = { ...state.poolingByeCounts };
  const byes = state.byes.map((round) => [...round]);
  const luckyLosers = state.luckyLosers.map((round) => [...round]);
  const tieResolutions = { ...state.tieResolutions };

  for (let index = state.assignments.length - 1; index > roundIndex; index -= 1) {
    if (!state.assignments[index]?.length) continue;
    const round = state.rounds[index];
    // A fixed draw is folded into the history at generation and never re-recorded.
    if (!round.fixedRoomAssignments) {
      roomHistory = rewindRoomHistory(roomHistory, state.assignments, index);
    }
    if (advanceCountedPoolingBye(round)) undoPoolingByeCounts(poolingByeCounts, byes[index] ?? []);
    if (byes[index]) byes[index] = [];
    if (luckyLosers[index]) luckyLosers[index] = [];
    for (const key of Object.keys(tieResolutions)) {
      if (key.startsWith(`r${index}-`)) delete tieResolutions[key];
    }
  }

  return {
    ...state,
    assignments: state.assignments.slice(0, roundIndex + 1),
    roomHistory,
    poolingByeCounts,
    byes,
    luckyLosers,
    tieResolutions,
  };
}
