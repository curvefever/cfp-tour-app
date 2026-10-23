import { isUncontestedRoom } from './advancement';
import { currentColumn, nextColumnStart, roundColumn } from './round-columns';
import { isRoomScored, occupiedRooms } from './scoring';
import { advanceTournamentRound } from './transitions';
import type { RoundAssignment, TournamentState } from './types';

/** What one round of the next column is expected to look like: its room sizes as fitted to the units arriving, its line-up and the units sitting it out. */
export interface ExpectedRound {
  rooms: number[];
  assignments: RoundAssignment[];
  byes: string[];
}

/** Whether every contested room of every round of the column in play has every score in. */
function isColumnScored(state: TournamentState): boolean {
  const { start, end } = currentColumn(state);
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    const unscored = occupiedRooms(state, roundIndex).some(
      (room) => !isUncontestedRoom(state, roundIndex, room) && !isRoomScored(state, roundIndex, room),
    );
    if (unscored) return false;
  }
  return true;
}

/** Whether a round of the next column already has its line-up: drawn, or published ahead (a fixed draw, a group-stage pairing). */
function isNextColumnDecided(state: TournamentState, start: number, end: number): boolean {
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    const round = state.rounds[roundIndex];
    if (state.assignments[roundIndex]?.length || round.fixedRoomAssignments || round.matches) return true;
  }
  return false;
}

/**
 * The draw of the next column as "Next Round" would make it from the results so far, or null while that is
 * not determined: the tournament has not started, there is no next column, a round of the column in play
 * still has a contested room without every score, a tie waits to be settled (or the advance is refused for
 * any other reason), or the next column is already drawn or published. Pure: nothing is written, and the
 * input state is not changed.
 */
export function expectedNextColumn(state: TournamentState): Map<number, ExpectedRound> | null {
  const start = nextColumnStart(state);
  if (!state.started || start >= state.rounds.length) return null;
  const { end } = roundColumn(state.rounds, start);
  if (isNextColumnDecided(state, start, end) || !isColumnScored(state)) return null;

  const advanced = advanceTournamentRound(state);
  if (advanced.status !== 'advanced') return null;
  const expected = new Map<number, ExpectedRound>();
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    const assignments = advanced.state.assignments[roundIndex] ?? [];
    if (assignments.length === 0) continue;
    expected.set(roundIndex, {
      rooms: advanced.state.rounds[roundIndex].rooms,
      assignments,
      byes: advanced.state.byes[roundIndex] ?? [],
    });
  }
  return expected.size > 0 ? expected : null;
}
