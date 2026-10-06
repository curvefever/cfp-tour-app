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
 * elimination or waterfall round routes into pools that a re-draw can't
 * rebuild, so those step forward instead (see docs/rules.md, "Going back a round").
 */
export function drawnAheadStatus(state: TournamentState, roundIndex: number): DrawnAheadStatus {
  if (!state.assignments[roundIndex + 1]?.length) return 'none';
  const round = state.rounds[roundIndex];
  if (round?.bracket || round?.isWaterfall) return 'locked';
  for (let index = roundIndex + 1; index < state.assignments.length; index += 1) {
    if (!state.assignments[index]?.length) continue;
    if (roundHasAnyScore(state, index, state.rounds[index])) return 'locked';
  }
  return 'redraw';
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
