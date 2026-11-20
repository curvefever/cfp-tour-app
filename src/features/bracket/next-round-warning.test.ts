import { describe, expect, it } from 'vitest';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import { scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { buildState } from '../../domain/tournament/__tests__/play-through';
import { liveTournament } from '../../domain/tournament/__tests__/qual-waterfall';
import { unscoredRooms } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import {
  afterFiveAbsent,
  afterThreeAbsent,
  built,
  playRound,
  players,
} from '../../domain/tournament/__tests__/layered-test-support';
import { keepLayeredPlan } from '../../domain/tournament/layered-replan';
import { layeredPlanWarning, unscoredRoomsMessage } from './next-round-warning';

describe('unscoredRoomsMessage', () => {
  it('names a room of a single round plainly, and lists several with commas', () => {
    const start = buildState({
      label: 'ffa 37',
      count: 37,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '24',
      },
    });
    if (!start) throw new Error('generation failed');
    const scored = scoreCurrentRound(start, 0);
    const withoutRooms = (rooms: number[]): TournamentState => ({
      ...scored,
      scores: Object.fromEntries(
        Object.entries(scored.scores).filter(
          ([key]) => !rooms.some((room) => key.startsWith(`r0-rm${room}-`)),
        ),
      ),
    });
    expect(unscoredRoomsMessage(withoutRooms([2]), unscoredRooms(withoutRooms([2])))).toBe(
      'No score yet in Room B. Go to the next round anyway?',
    );
    expect(unscoredRoomsMessage(withoutRooms([2, 4]), unscoredRooms(withoutRooms([2, 4])))).toBe(
      'No score yet in Room B, Room D. Go to the next round anyway?',
    );
  });

  it('names each room with its round in a column of several rounds', () => {
    let state = liveTournament(19);
    for (let guard = 0; guard < 20 && !state.rounds[state.curRound].isWaterfall; guard += 1) {
      const result = advanceTournamentRound(scoreCurrentRound(state, 2));
      if (result.status !== 'advanced') throw new Error('could not advance');
      state = result.state;
    }
    const lower = state.rounds.findIndex((round) => round.customLabel === 'Round 5 Lower');
    const scored = scoreCurrentRound(state, 2);
    const message = unscoredRoomsMessage(scored, [{ roundIndex: lower, room: 2 }]);
    expect(message).toBe('No score yet in Round 5 Lower · Room B. Go to the next round anyway?');
  });
});

describe('layeredPlanWarning', () => {
  /** 31 registered, five absent after round 1 and round 2 (26 play): round 3, the last table round, in play. */
  const atLastTableRound = () => afterFiveAbsent();

  it('names a waiting new plan on the last table round, and says Next Round plays the plan in use', () => {
    const state = atLastTableRound();
    expect(state.curRound).toBe(state.rounds.findIndex((round) => round.isWaterfall) - 1);
    expect(layeredPlanWarning(state)).toBe(
      'A new plan for the bracket is waiting in Admin: 26 play now. Next Round plays the plan in use.',
    );
  });

  it('is silent while the table has rounds to go, when no plan waits, and once the plan is kept', () => {
    expect(layeredPlanWarning(afterThreeAbsent())).toBeNull();
    // The same three stay absent in round 2: 28 play, as planned.
    const three = afterThreeAbsent();
    const noChange = playRound(three, players(three).slice(0, 3));
    expect(layeredPlanWarning(noChange)).toBeNull();
    expect(layeredPlanWarning(keepLayeredPlan(atLastTableRound()))).toBeNull();
  });

  it('is silent for a tournament that is not a layered bracket', () => {
    const start = buildState({
      label: 'ffa 37',
      count: 37,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '24',
      },
    });
    if (!start) throw new Error('no state');
    expect(layeredPlanWarning(start)).toBeNull();
    expect(layeredPlanWarning(built(31))).toBeNull();
    expect(players(built(31))).toHaveLength(31);
  });
});
