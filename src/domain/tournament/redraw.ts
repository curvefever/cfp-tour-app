import { currentUnit, replayBracketPools } from './bracket-replay';
import { rosterKeys } from './roster';
import { roundHasAnyScore } from './scoring';
import { rewindRoomHistory } from './seeding';
import { roundColumn } from './round-columns';
import type { TournamentRound, TournamentState } from './types';

/**
 * What "Next Round" does when the round after `roundIndex` is already drawn
 * (the organiser pressed Previous): nothing drawn ahead, re-draw it from the
 * current results, or step forward to it unchanged.
 */
export type DrawnAheadStatus = 'none' | 'redraw' | 'locked';

/**
 * A later drawn round with scores can't be thrown away: it steps forward (see docs/rules.md, "Going back a
 * round"). A double elimination or waterfall round that has been advanced from (anything from `roundIndex`
 * up to the one before the last drawn round) already pushed its units into pendingBracketSeeds; a re-draw
 * rebuilds those pools by replaying the rounds before it, and only goes ahead when that replay explains the
 * pools as they are now (`replayExplainsPools`), else it steps forward too.
 */
export function drawnAheadStatus(state: TournamentState, roundIndex: number): DrawnAheadStatus {
  const next = roundColumn(state.rounds, roundIndex).end + 1;
  if (!state.assignments[next]?.length) return 'none';
  const lastDrawn = lastDrawnIndex(state);
  for (let index = next; index <= lastDrawn; index += 1) {
    if (!state.assignments[index]?.length) continue;
    if (roundHasAnyScore(state, index, state.rounds[index])) return 'locked';
  }
  // The last drawn column hasn't been advanced from: only the rounds before its first one have.
  const lastAdvanced = roundColumn(state.rounds, lastDrawn).start;
  for (let index = roundIndex; index < lastAdvanced; index += 1) {
    if (state.rounds[index]?.bracket || state.rounds[index]?.isWaterfall) {
      return replayExplainsPools(state, roundIndex) ? 'redraw' : 'locked';
    }
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

const sortedNames = (names: string[]): string[] => [...names].sort();

/**
 * True when the recorded results explain every bracket pool and lucky-loser list after `roundIndex`'s
 * column: for each later round, the units it holds now (its pool, its line-up and its byes, current names,
 * withdrawn units gone) minus every unit of the rounds about to be advanced from again (their line-ups and
 * byes) are exactly the units the replay of the rounds before the column sends it. Each unit is in one place
 * at a time, so the subtraction is exact. Anything else (a removal made while viewing an earlier round, a
 * hand-edited database) is an unknown state a re-draw must not build on.
 */
function replayExplainsPools(state: TournamentState, roundIndex: number): boolean {
  const { start, end: keep } = roundColumn(state.rounds, roundIndex);
  const lastAdvanced = roundColumn(state.rounds, lastDrawnIndex(state)).start;
  const roster = new Set(rosterKeys(state.players));
  const current = (names: string[]) => names.flatMap((name) => currentUnit(state, roster, name) ?? []);
  const lineUp = (index: number) => (state.assignments[index] ?? []).map((entry) => entry.name);
  const redone = new Set(
    current(
      Array.from({ length: Math.max(lastAdvanced - start, 0) }, (_, offset) => start + offset).flatMap(
        (index) => [...lineUp(index), ...(state.byes[index] ?? [])],
      ),
    ),
  );
  const outsideRedone = (names: string[]) => sortedNames(current(names).filter((name) => !redone.has(name)));
  const replay = replayBracketPools(state, start);
  const same = (actual: string[], replayed: string[] | undefined) =>
    JSON.stringify(actual) === JSON.stringify(sortedNames(replayed ?? []));

  for (let index = keep + 1; index < state.rounds.length; index += 1) {
    const held = [
      ...(state.pendingBracketSeeds[index] ?? []).map((seed) => seed.name),
      ...lineUp(index),
      ...(state.byes[index] ?? []),
    ];
    const replayedPool = replay.pools.get(index)?.map((seed) => seed.name);
    if (!same(outsideRedone(held), replayedPool)) return false;
    if (!same(outsideRedone(state.luckyLosers[index] ?? []), replay.lucky.get(index))) return false;
  }
  return true;
}

/**
 * Pure. Throws away every draw after `roundIndex` so the next advance starts
 * from the same bookkeeping as a first advance: the discarded rounds'
 * roomHistory entries, pooling-bye counts, byes and tie resolutions are
 * undone, and the pending pools and lucky losers of every later round are
 * rebuilt by replaying the rounds before `roundIndex`'s column (the units
 * those rounds sent on are the only ones that can be waiting). Highest round
 * first, so each rewind still sees the earlier (also stale) rounds it
 * replays. Round shapes are left alone; the advance re-fits them.
 */
export function discardDrawsAfter(state: TournamentState, roundIndex: number): TournamentState {
  const keep = roundColumn(state.rounds, roundIndex).end;
  let roomHistory = state.roomHistory;
  const poolingByeCounts = { ...state.poolingByeCounts };
  const byes = state.byes.map((round) => [...round]);
  const tieResolutions = { ...state.tieResolutions };
  const replay = replayBracketPools(state, roundColumn(state.rounds, roundIndex).start);
  const pendingBracketSeeds = Object.fromEntries([
    ...Object.entries(state.pendingBracketSeeds).filter(([index]) => Number(index) <= keep),
    ...[...replay.pools].filter(([index]) => index > keep),
  ]);
  const luckyLosers = state.luckyLosers.map((round, index) =>
    index > keep ? [...(replay.lucky.get(index) ?? [])] : [...round],
  );

  for (let index = state.assignments.length - 1; index > keep; index -= 1) {
    if (!state.assignments[index]?.length) continue;
    const round = state.rounds[index];
    // A fixed draw is folded into the history at generation and never re-recorded.
    if (!round.fixedRoomAssignments) {
      roomHistory = rewindRoomHistory(roomHistory, state.assignments, index);
    }
    if (advanceCountedPoolingBye(round)) undoPoolingByeCounts(poolingByeCounts, byes[index] ?? []);
    if (byes[index]) byes[index] = [];
    for (const key of Object.keys(tieResolutions)) {
      if (key.startsWith(`r${index}-`)) delete tieResolutions[key];
    }
  }

  return {
    ...state,
    assignments: state.assignments.slice(0, keep + 1),
    roomHistory,
    poolingByeCounts,
    byes,
    luckyLosers,
    tieResolutions,
    pendingBracketSeeds,
  };
}
