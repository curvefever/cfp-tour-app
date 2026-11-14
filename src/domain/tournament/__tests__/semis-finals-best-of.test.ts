import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { bestOfGameCount, roomMatch, stageMatchFields } from '../match-format';
import { fitRoundToPool } from '../room-distribution';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { PersistedSetup, TournamentRound, TournamentState, TournamentTeam } from '../types';
import { generate as generateStarted, SE_FFA as SE_FFA_SETUP } from './fair-cut-fixtures';
import { playWithRemovals, pressNextRound, scoreCurrentRound } from './play-through';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { startedState } from './test-fixtures';

type Setup = Partial<PersistedSetup>;

function roster(count: number, teamSize: number): Array<string | TournamentTeam> {
  if (teamSize === 0) return Array.from({ length: count }, (_, index) => `P${index + 1}`);
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: teamSize }, (_, slot) => ({ name: `m${index}-${slot}` })),
  }));
}

function generate(count: number, teamSize: number, setup: Setup) {
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: roster(count, teamSize) as never }),
    createDefaultSetup({ poolingPhase: 'none', ...setup }),
    createTournamentRuntime(),
  );
}

function generated(count: number, teamSize: number, setup: Setup): TournamentState {
  return startedState(generate(count, teamSize, setup));
}

const semisOf = (state: TournamentState) => state.rounds.find((round) => round.isSemis) as TournamentRound;
const finalOf = (state: TournamentState) => state.rounds.find((round) => round.isFinal) as TournamentRound;

describe('stageMatchFields', () => {
  it('sums the games, or works the game count of a Best of N out for the largest room', () => {
    expect(stageMatchFields(3, undefined, 8)).toEqual({ numGames: 3 });
    expect(stageMatchFields(1, 3, 2)).toEqual({ bestOf: 3, numGames: 3 });
    expect(stageMatchFields(1, 3, 8)).toEqual({ bestOf: 3, numGames: bestOfGameCount(3, 8) });
    expect(stageMatchFields(3, 5, 4)).toEqual({ bestOf: 5, numGames: 9 });
  });
});

describe('single elimination with a Best of 3 Semis and Final, head to head', () => {
  for (const [label, gameFormat, teamSize] of [
    ['4v4', 'team-4v4', 4],
    ['1v1', 'individual-1v1', 0],
  ] as const) {
    for (const count of [31, 37, 43, 53]) {
      it(`${label} at ${count}: two Semis rooms of two and the Final are Best of 3 over 3 games`, () => {
        const state = generated(count, teamSize, {
          gameFormat,
          scheduleLogic: 'single-elimination',
          semisBestOf: '3',
          finalsBestOf: '3',
        });
        const semis = semisOf(state);
        expect(semis.rooms).toEqual([2, 2]);
        expect(semis).toMatchObject({ bestOf: 3, numGames: 3, luckyCount: 0 });
        expect(finalOf(state)).toMatchObject({ bestOf: 3, numGames: 3, players: 2 });
        expect(state.gamemodeConfig).toMatchObject({ semisBestOf: 3, finalsBestOf: 3 });
        expect(state.settings).toMatchObject({ semisBestOf: '3', finalsBestOf: '3' });
        const before = state.rounds.filter((round) => !round.isSemis && !round.isFinal);
        expect(before.every((round) => round.bestOf === undefined)).toBe(true);
      });
    }
  }

  it('reads a Semis room as a Best of 3 and sends its winner to the Final', () => {
    let state = generated(8, 4, {
      gameFormat: 'team-4v4',
      scheduleLogic: 'single-elimination',
      semisBestOf: '3',
      finalsBestOf: '3',
      teamScoringRule: ONE_SCORE_PER_TEAM,
    });
    while (!state.rounds[state.curRound].isSemis) {
      state = pressNextRound(scoreCurrentRound(state, 0));
    }
    const round = state.curRound;
    const seats = state.assignments[round].filter((entry) => entry.room === 1).map((entry) => entry.name);
    const scores = { ...state.scores };
    seats.forEach((_, position) => {
      scores[`r${round}-rm1-p${position}-g1`] = position === 1 ? 30 : 10;
      scores[`r${round}-rm1-p${position}-g2`] = position === 1 ? 30 : 10;
    });
    state = { ...state, scores };
    expect(roomMatch(state, round, 1)).toMatchObject({ decidingGame: 2, complete: true });
    expect(roomMatch(state, round, 2)?.complete).toBe(false);
  });

  it('plays the other schedule logics the same way: an existing setup is unchanged', () => {
    const state = generated(37, 4, { gameFormat: 'team-4v4', scheduleLogic: 'single-elimination' });
    expect(semisOf(state)).not.toHaveProperty('bestOf');
    expect(semisOf(state).numGames).toBe(1);
    expect(finalOf(state)).not.toHaveProperty('bestOf');
    expect(finalOf(state).numGames).toBe(3);
    expect(state.gamemodeConfig).not.toHaveProperty('semisBestOf');
    expect(state.gamemodeConfig).not.toHaveProperty('finalsBestOf');
  });
});

describe('Best of N in a format with more than two units per room', () => {
  it('FFA at 37: a Best of 3 Final works its games out for the Final room (8 x 1 + 1 = 9)', () => {
    const state = generated(37, 0, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      finalsBestOf: '3',
    });
    expect(finalOf(state)).toMatchObject({ bestOf: 3, numGames: bestOfGameCount(3, finalOf(state).players) });
    expect(finalOf(state).numGames).toBe(9);
    expect(semisOf(state)).not.toHaveProperty('bestOf');
  });

  it('FFA at 37: a Best of 3 Semis works its games out for its largest room', () => {
    const state = generated(37, 0, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      semisBestOf: '3',
    });
    expect(semisOf(state)).toMatchObject({
      bestOf: 3,
      numGames: bestOfGameCount(3, Math.max(...semisOf(state).rooms)),
    });
  });

  it('1v1 at 31: a Best of 3 Semis may send lucky losers to the Final', () => {
    const state = generated(31, 0, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      semisBestOf: '3',
      semisOverride: '6',
    });
    expect(semisOf(state)).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(semisOf(state).luckyCount).toBeGreaterThan(0);
  });

  it('ignores a Best of N setting whose select is hidden: the Semis in other schedules, the race Grand Final', () => {
    const kings = generated(24, 0, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'kings-valley',
      semisBestOf: '3',
    });
    expect(kings.gamemodeConfig).not.toHaveProperty('semisBestOf');
    const race = generated(16, 0, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      finalsBestOf: '3',
    });
    expect(race.gamemodeConfig).not.toHaveProperty('finalsBestOf');
    expect(finalOf(race)).not.toHaveProperty('bestOf');
  });

  it('ignores a value that is not a Best of N', () => {
    const state = generated(31, 4, {
      gameFormat: 'team-4v4',
      scheduleLogic: 'single-elimination',
      finalsBestOf: '4',
    });
    expect(finalOf(state)).not.toHaveProperty('bestOf');
  });
});

describe('the Final of the other bracket formats', () => {
  it('Kings Valley: the Final is a Best of 3 worked out for its room', () => {
    const state = generated(24, 0, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'kings-valley',
      finalsBestOf: '3',
    });
    const final = finalOf(state);
    expect(final).toMatchObject({ bestOf: 3 });
    expect(final.numGames).toBe(bestOfGameCount(3, final.players));
  });

  it('shared-Final double elimination: the shared Final is a Best of 3', () => {
    const state = generated(37, 0, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      finalsBestOf: '3',
    });
    const final = finalOf(state);
    expect(final).toMatchObject({ bestOf: 3 });
    expect(final.numGames).toBe(bestOfGameCount(3, final.players));
  });

  it('the Custom bracket: a Final with no format of its own follows the Finals format, a token of its own wins', () => {
    const graph = (finalToken: string) =>
      [
        'ROUNDS:',
        'R1 = 2x2',
        `Final = 2 FINAL${finalToken}`,
        'ROUTES:',
        'R1.A: 1->Final',
        'R1.B: 1->Final',
      ].join('\n');
    const follows = generated(4, 0, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'waterfall-bracket',
      finalsBestOf: '3',
      waterfallGraph: graph(''),
    });
    expect(finalOf(follows)).toMatchObject({ bestOf: 3, numGames: 3 });
    const own = generated(4, 0, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'waterfall-bracket',
      finalsBestOf: '3',
      waterfallGraph: graph(' GAMES 2'),
    });
    expect(finalOf(own)).toMatchObject({ numGames: 2 });
    expect(finalOf(own)).not.toHaveProperty('bestOf');
  });
});

describe('refitting a Best of N round to the units that reach it', () => {
  const final: TournamentRound = {
    roundNum: 9,
    players: 8,
    rooms: [8],
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: true,
    advPerRoom: 1,
    advTotal: 1,
    luckyCount: 0,
    bestOf: 3,
    numGames: 9,
  };

  it('keeps bestOf and works the game count out for the new room (a withdrawal, a late joiner)', () => {
    const roomSize = { min: 6, max: 8, ideal: 8 };
    expect(fitRoundToPool(final, 6, roomSize)).toMatchObject({ rooms: [6], bestOf: 3, numGames: 7 });
    expect(fitRoundToPool(final, 8, roomSize)).toBe(final);
  });

  describe('a Best of N Semis', () => {
    const headToHead = { min: 2, max: 2, ideal: 2 };
    const ffa = { min: 6, max: 8, ideal: 8 };
    const semis: TournamentRound = {
      ...final,
      roundNum: 8,
      players: 4,
      rooms: [2, 2],
      isSemis: true,
      isFinal: false,
      advPerRoom: 1,
      advTotal: 2,
      numGames: 3,
    };
    const ffaSemis: TournamentRound = {
      ...semis,
      players: 16,
      rooms: [8, 8],
      advPerRoom: 4,
      advTotal: 8,
      numGames: 9,
    };

    it('a head-to-head Best of 3 Semis one unit short keeps its 3 games', () => {
      expect(fitRoundToPool(semis, 3, headToHead)).toMatchObject({
        rooms: [2, 1],
        players: 3,
        advTotal: 2,
        bestOf: 3,
        numGames: 3,
      });
    });

    it('a head-to-head Semis with its bye taken first is one room of 2', () => {
      expect(fitRoundToPool({ ...semis, byeCount: 1 }, 2, headToHead)).toMatchObject({
        rooms: [2],
        players: 3,
        byeCount: 1,
        bestOf: 3,
        numGames: 3,
      });
    });

    it('an FFA Semis down to 15 keeps 9 games: its largest room is still 8', () => {
      expect(fitRoundToPool(ffaSemis, 15, ffa)).toMatchObject({
        rooms: [8, 7],
        players: 15,
        advTotal: 8,
        bestOf: 3,
        numGames: 9,
      });
    });

    it('an FFA Semis down to 14 plays 8 games (7 x 1 + 1)', () => {
      expect(fitRoundToPool(ffaSemis, 14, ffa)).toMatchObject({
        rooms: [7, 7],
        players: 14,
        advTotal: 8,
        bestOf: 3,
        numGames: 8,
      });
    });

    it('a Best of 5 Semis down to 14 plays 15 games (7 x 2 + 1)', () => {
      const bestOfFive = { ...ffaSemis, bestOf: 5, numGames: 17 };
      expect(fitRoundToPool(bestOfFive, 14, ffa)).toMatchObject({
        rooms: [7, 7],
        bestOf: 5,
        numGames: 15,
      });
    });
  });

  it('leaves a Final of summed games alone', () => {
    const summed = { ...final, bestOf: undefined, numGames: 3 };
    delete summed.bestOf;
    expect(fitRoundToPool(summed, 6, { min: 6, max: 8, ideal: 8 })).toMatchObject({
      rooms: [6],
      numGames: 3,
    });
  });
});

describe('a Best-of Semis left short by withdrawals, played to the Final', () => {
  const SE_FFA: Setup = { ...SE_FFA_SETUP };
  const lowestRoomFirst = (state: TournamentState) =>
    (state.assignments[state.curRound] ?? [])
      .filter((entry) => entry.room !== null)
      .sort((first, second) => (first.room ?? 0) - (second.room ?? 0))[0]?.name;

  function playToFinal(
    count: number,
    setup: Setup,
    teamSize: number,
    withdrawals: number,
    victimFor?: (state: TournamentState) => string | undefined,
  ) {
    const start = generateStarted(`${setup.gameFormat} ${count}`, count, {
      ...setup,
      semisBestOf: '3',
      finalsBestOf: '3',
    });
    const semisIndex = start.rounds.findIndex((round) => round.isSemis);
    const played = playWithRemovals(
      start,
      teamSize,
      Array<number>(withdrawals).fill(semisIndex - 1),
      victimFor,
    );
    return {
      outcome: played.outcome,
      state: played.state,
      semis: played.state.rounds[semisIndex],
      final: played.state.rounds[semisIndex + 1],
    };
  }

  it('FFA at 37: one withdrawal never shortens the Semis', () => {
    const { outcome, semis, final } = playToFinal(37, SE_FFA, 0, 1);
    expect(outcome.kind).toBe('ok');
    expect(semis).toMatchObject({ rooms: [8, 8], numGames: 9 });
    expect(final).toMatchObject({ rooms: [8], numGames: 9 });
  });

  it.each([31, 37, 53])('FFA at %i, 5 withdrawals: Semis [8, 7] keeps its 9 games', (count) => {
    const { outcome, state, semis, final } = playToFinal(count, SE_FFA, 0, 5);
    expect(outcome.kind).toBe('ok');
    expect(state.rounds[state.curRound].isFinal).toBe(true);
    expect(semis).toMatchObject({ rooms: [8, 7], players: 15, bestOf: 3, numGames: 9 });
    expect(final).toMatchObject({ rooms: [8], numGames: 9 });
  });

  it.each([31, 37, 53])('FFA at %i, 6 withdrawals: Semis [7, 7] plays 8 games', (count) => {
    const { outcome, state, semis, final } = playToFinal(count, SE_FFA, 0, 6);
    expect(outcome.kind).toBe('ok');
    expect(state.rounds[state.curRound].isFinal).toBe(true);
    expect(semis).toMatchObject({ rooms: [7, 7], players: 14, bestOf: 3, numGames: 8 });
    expect(final).toMatchObject({ rooms: [8], numGames: 9 });
  });

  it('FFA at 43 (round before 7/6/6), 5 withdrawals: Semis [7, 7] plays 8 games', () => {
    const { outcome, state, semis, final } = playToFinal(43, SE_FFA, 0, 5);
    expect(outcome.kind).toBe('ok');
    expect(state.rounds[state.curRound].isFinal).toBe(true);
    expect(semis).toMatchObject({ rooms: [7, 7], numGames: 8 });
    expect(final).toMatchObject({ rooms: [8], numGames: 9 });
  });

  it('FFA at 43, 6 withdrawals: Semis [7, 6] plays 8 games', () => {
    const { outcome, state, semis, final } = playToFinal(43, SE_FFA, 0, 6);
    expect(outcome.kind).toBe('ok');
    expect(state.rounds[state.curRound].isFinal).toBe(true);
    expect(semis).toMatchObject({ rooms: [7, 6], players: 13, numGames: 8 });
    expect(final).toMatchObject({ rooms: [8], numGames: 9 });
  });

  describe.each([
    ['1v1', 'individual-1v1', 0],
    ['2v2', 'team-2v2', 2],
  ] as const)('%s', (_label, gameFormat, teamSize) => {
    it.each([31, 37, 43, 53])(
      'at %i, 5 withdrawals leave a Semis of one room of 2 and a bye, 3 games',
      (count) => {
        const setup = { ...SE_FFA, gameFormat };
        const { outcome, state, semis, final } = playToFinal(count, setup, teamSize, 5, lowestRoomFirst);
        expect(outcome.kind).toBe('ok');
        expect(state.rounds[state.curRound].isFinal).toBe(true);
        expect(semis).toMatchObject({ rooms: [2], byeCount: 1, players: 3, bestOf: 3, numGames: 3 });
        expect(final).toMatchObject({ rooms: [2], numGames: 3 });
      },
    );
  });
});
