import { describe, expect, it } from 'vitest';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState, playWithRemovals, scoreCurrentRound, type SweepConfig } from './play-through';

/**
 * A removal in a winners-bracket round leaves the losers bracket one drop
 * short. These play real double-elimination tournaments through the real
 * transition code to the Final and check how each family of former block now
 * plays out.
 */

const sharedFinal = (count: number, poolingPhase: 'none' | 'qual-table'): SweepConfig => ({
  label: `ffa ${count} ${poolingPhase}`,
  count,
  teams: false,
  setup: {
    gameFormat: 'ffa-individual',
    scheduleLogic: 'double-elimination-shared-final',
    poolingPhase,
  },
});

const race: SweepConfig = {
  label: '1v1 12 race',
  count: 12,
  teams: false,
  setup: {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'double-elimination',
    poolingPhase: 'none',
    oddCountStrategy: 'bye',
  },
};

const seatsOf = (state: TournamentState, roundIndex: number) =>
  state.rounds[roundIndex].rooms.reduce((total, size) => total + size, 0);

const lastIndex = (state: TournamentState) => state.rounds.length - 1;

describe('shared Final: a cut-by-one losers round eliminates one instead of blocking', () => {
  it.each([
    ['FFA 17, no pooling, removal in the first winners round', sharedFinal(17, 'none'), 2, 4],
    ['FFA 37, Qualification Table, removal in the first winners round', sharedFinal(37, 'qual-table'), 3, 5],
  ] as const)('%s', (_label, config, removalRound, cutByOneRound) => {
    const start = buildState(config) as TournamentState;
    // Planned to cut by exactly one.
    const planned = start.rounds[cutByOneRound];
    expect(planned.bracket).toBe('losers');
    expect(planned.players - planned.advTotal).toBe(1);

    const played = playWithRemovals(start, 0, [removalRound]);
    expect(played.outcome).toEqual({ kind: 'ok' });

    const fitted = played.state.rounds[cutByOneRound];
    expect(seatsOf(played.state, cutByOneRound)).toBe(planned.players - 1);
    expect(fitted.players - fitted.advTotal).toBe(1);

    // The Final still seats everyone it planned for.
    const finalIndex = lastIndex(start);
    expect(played.state.curRound).toBe(finalIndex);
    expect(played.state.assignments[finalIndex]).toHaveLength(start.rounds[finalIndex].players);
    expect(seatsOf(played.state, finalIndex)).toBe(start.rounds[finalIndex].players);
  });
});

describe('shared Final: a Final that receives fewer units than planned still plays', () => {
  it('FFA 17: one removal in the first winners round and two in a later one leave a Final of 7 instead of 8', () => {
    const start = buildState(sharedFinal(17, 'none')) as TournamentState;
    const finalIndex = lastIndex(start);
    expect(start.rounds[finalIndex].players).toBe(8);

    const played = playWithRemovals(start, 0, [2, 7, 7]);
    expect(played.outcome).toEqual({ kind: 'ok' });
    expect(played.state.curRound).toBe(finalIndex);
    expect(played.state.rounds[finalIndex]).toMatchObject({ rooms: [7], players: 7 });
    expect(played.state.assignments[finalIndex]).toHaveLength(7);
  });

  it('still blocks when more units than the Final seats would arrive', () => {
    const start = buildState(sharedFinal(17, 'none')) as TournamentState;
    const finalIndex = lastIndex(start);
    let state = start;
    while (state.curRound < finalIndex - 1) {
      const result = advanceTournamentRound(scoreCurrentRound(state, 0));
      if (result.status !== 'advanced') throw new Error('did not advance');
      state = result.state;
    }
    const extra = [{ name: 'X1' }, { name: 'X2' }, { name: 'X3' }].map((unit) => ({
      ...unit,
      isLucky: false,
      tierRank: 0,
      pct: 1,
    }));
    state = {
      ...state,
      pendingBracketSeeds: {
        ...state.pendingBracketSeeds,
        [finalIndex]: [...(state.pendingBracketSeeds[finalIndex] ?? []), ...extra],
      },
    };
    const result = advanceTournamentRound(scoreCurrentRound(state, 0));
    expect(result).toMatchObject({ status: 'blocked', reason: 'malformed-final' });
  });
});

describe('race Grand Final: removing a winners-bracket finalist makes the losers final a walkover', () => {
  it('1v1 12 with "Bye": the losers survivor goes straight to the Grand Final with the other finalist', () => {
    const start = buildState(race) as TournamentState;
    const wbFinalIndex = 10;
    expect(start.rounds[wbFinalIndex]).toMatchObject({ bracket: 'winners', rooms: [2] });
    let otherFinalist = '';
    const played = playWithRemovals(start, 0, [wbFinalIndex], (state) => {
      const [removed, other] = (state.assignments[state.curRound] ?? []).map((entry) => entry.name);
      otherFinalist = other;
      return removed;
    });
    expect(played.outcome).toEqual({ kind: 'ok' });

    const state = played.state;
    const lbFinalIndex = wbFinalIndex + 1;
    const survivor = state.byes[lbFinalIndex][0];
    expect(survivor).toBeDefined();
    expect(state.rounds[lbFinalIndex]).toMatchObject({ rooms: [], players: 1, advTotal: 1, advPerRoom: 0 });
    expect(state.assignments[lbFinalIndex]).toEqual([{ name: survivor, room: null, isLucky: false }]);

    const grandFinal = lbFinalIndex + 1;
    expect(state.curRound).toBe(grandFinal);
    expect(state.assignments[grandFinal].map((entry) => entry.name).sort()).toEqual(
      [otherFinalist, survivor].sort(),
    );
    expect(state.rounds[grandFinal].wbFinalistName).toBe(otherFinalist);
  });
});

describe('race double elimination: an odd pool gets a bye whatever the odd-count strategy', () => {
  const raceOf = (
    count: number,
    poolingPhase: 'none' | 'qual-table',
    oddCountStrategy: string,
  ): SweepConfig => ({
    label: `1v1 ${count} race ${poolingPhase} ${JSON.stringify(oddCountStrategy)}`,
    count,
    teams: false,
    setup: {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase,
      oddCountStrategy: oddCountStrategy as 'none',
    },
  });

  it.each([
    ['no pooling', 'none'],
    ['a Qualification Table (8 advancing)', 'qual-table'],
  ] as const)(
    '1v1 16, strategy "None", %s: a removal in the first winners round plays to the Grand Final',
    (_label, pooling) => {
      const start = buildState(raceOf(16, pooling, 'none')) as TournamentState;
      const firstWinners = start.rounds.findIndex((round) => round.bracket === 'winners');
      const played = playWithRemovals(start, 0, [firstWinners]);
      expect(played.outcome).toEqual({ kind: 'ok' });
      expect(played.state.rounds[played.state.curRound].bracket).toBe('grand-final');
      // The losers round the removed unit's missing drop feeds holds the bye.
      const fed = start.rounds[firstWinners].losersTo as number;
      expect(played.state.byes[fed]).toHaveLength(1);
    },
  );

  it('1v1 13 with the strategy unset and no removal: an odd field now plays to the Grand Final', () => {
    const start = buildState(raceOf(13, 'none', '')) as TournamentState;
    const played = playWithRemovals(start, 0, []);
    expect(played.outcome).toEqual({ kind: 'ok' });
    expect(played.state.rounds[played.state.curRound].bracket).toBe('grand-final');
  });

  it('1v1 33, strategy unset: a removal that leaves the first losers round nobody to play skips it', () => {
    const start = buildState(raceOf(33, 'none', '')) as TournamentState;
    const firstWinners = start.rounds.findIndex((round) => round.bracket === 'winners');
    const emptied = start.rounds[firstWinners].losersTo as number;
    // Planned as a lone-unit room fed by the one drop of the first winners round.
    expect(start.rounds[emptied].players).toBe(1);

    const played = playWithRemovals(start, 0, [firstWinners]);
    expect(played.outcome).toEqual({ kind: 'ok' });
    expect(played.state.rounds[played.state.curRound].bracket).toBe('grand-final');
    expect(played.state.rounds[emptied]).toMatchObject({ rooms: [], players: 0, advTotal: 0 });
    expect(played.state.assignments[emptied] ?? []).toEqual([]);
  });
});
