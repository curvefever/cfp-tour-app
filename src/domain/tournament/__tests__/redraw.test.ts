import { describe, expect, it } from 'vitest';
import { discardDrawsAfter, drawnAheadStatus } from '../redraw';
import { scoreKeysForPosition } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';

/**
 * Invariant: a re-draw equals a first advance from the corrected state, i.e.
 * advance(back(advance(S))) deep-equals advance(S) on every field a draw
 * writes, with and without a score edit in the round being advanced from.
 */

const VIEW_KEYS = [
  'assignments',
  'byes',
  'luckyLosers',
  'roomHistory',
  'poolingByeCounts',
  'rounds',
  'curRound',
] as const;

function view(state: TournamentState) {
  return Object.fromEntries(VIEW_KEYS.map((key) => [key, state[key]]));
}

function advanceOk(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') {
    throw new Error(`expected an advance, got ${result.status}: ${JSON.stringify(result).slice(0, 300)}`);
  }
  return result.state;
}

function back(state: TournamentState): TournamentState {
  return { ...state, curRound: state.curRound - 1 };
}

/** Scores the current round; `reversed` flips every room's order, which changes who advances. */
function scoreRound(state: TournamentState, teamSize: number, reversed: boolean): TournamentState {
  if (!reversed) return scoreCurrentRound(state, teamSize);
  const scored = scoreCurrentRound(state, teamSize);
  const round = state.rounds[state.curRound];
  const scores = { ...scored.scores };
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
    keys.forEach((key, index) => {
      scores[key] = index === 0 ? 10 * counter + state.curRound : 1;
    });
  }
  return { ...scored, scores };
}

function build(config: SweepConfig): TournamentState {
  const state = buildState(config);
  if (!state) throw new Error(`generation refused: ${config.label}`);
  return state;
}

/** Plays (scored, distinct values) until `stop` holds on an unscored current round. */
function playUntil(
  start: TournamentState,
  teamSize: number,
  stop: (state: TournamentState) => boolean,
): TournamentState {
  let state = start;
  for (let guard = 0; guard < 40; guard += 1) {
    if (stop(state)) return state;
    state = advanceOk(scoreRound(state, teamSize, false));
  }
  throw new Error('stop condition never reached');
}

function isFirstElimination(round: TournamentState['rounds'][number]): boolean {
  return !round.isNoElim && !round.isQual && !round.isSwiss && !round.isGroupStage && !round.isFinal;
}

/** `editChangesDraw` is false for predetermined draws (fixed, group stage), where scores can't move anyone. */
function expectRedrawEquivalence(atRound: TournamentState, teamSize: number, editChangesDraw = true): void {
  // No edit: the re-draw reproduces the first advance exactly.
  const first = advanceOk(scoreRound(atRound, teamSize, false));
  expect(first.assignments[atRound.curRound + 1]?.length).toBeGreaterThan(0);
  expect(view(advanceOk(back(first)))).toEqual(view(first));

  // A score edit in the round advanced from: the re-draw equals advancing the corrected state.
  const expected = advanceOk(scoreRound(atRound, teamSize, true));
  const redone = advanceOk(scoreRound(back(first), teamSize, true));
  expect(view(redone)).toEqual(view(expected));
  // The edit must really change the next draw, or the check proves nothing.
  if (editChangesDraw) {
    expect(redone.assignments[atRound.curRound + 1]).not.toEqual(first.assignments[atRound.curRound + 1]);
  }
}

const FFA = { gameFormat: 'ffa-individual' } as const;
const H2H = { gameFormat: 'individual-1v1', oddCountStrategy: 'bye' } as const;

describe('Next Round after Previous re-draws like a first advance', () => {
  it('2v2v2v2 qual-table, 23 teams: re-advance into the first elimination round', () => {
    const config: SweepConfig = {
      label: '2v2v2v2 23',
      count: 23,
      teams: true,
      setup: { gameFormat: 'team-2v2v2v2', scheduleLogic: 'single-elimination', poolingPhase: 'qual-table' },
    };
    const atRound = playUntil(build(config), 3, (state) =>
      isFirstElimination(state.rounds[state.curRound + 1]),
    );
    expect(atRound.rounds[atRound.curRound].isQual).toBe(true);
    expectRedrawEquivalence(atRound, 3);
  });

  describe('FFA, no pooling, 37 players', () => {
    const config: SweepConfig = {
      label: 'ffa 37 none',
      count: 37,
      teams: false,
      setup: { ...FFA, scheduleLogic: 'single-elimination', poolingPhase: 'none' },
    };

    it('from a warm-up round', () => {
      const atRound = build(config);
      expect(atRound.rounds[atRound.curRound].isNoElim).toBe(true);
      expectRedrawEquivalence(atRound, 0);
    });

    it('from an elimination round', () => {
      const atRound = playUntil(build(config), 0, (state) =>
        isFirstElimination(state.rounds[state.curRound]),
      );
      expectRedrawEquivalence(atRound, 0);
    });
  });

  it('1v1 Swiss, 31 players: pooling-bye counts come out identical', () => {
    const config: SweepConfig = {
      label: 'swiss 31',
      count: 31,
      teams: false,
      setup: { ...H2H, scheduleLogic: 'single-elimination', poolingPhase: 'swiss', qualAdv: '16' },
    };
    const atRound = playUntil(build(config), 0, (state) =>
      Boolean(state.rounds[state.curRound + 1]?.isSwiss),
    );
    const first = advanceOk(scoreRound(atRound, 0, false));
    expect(Object.keys(first.poolingByeCounts).length).toBeGreaterThan(0);
    expect(first.byes[atRound.curRound + 1]).toHaveLength(1);
    expectRedrawEquivalence(atRound, 0);
    // A second Swiss round, so a bye count already stands from the earlier round.
    const later = playUntil(
      atRound,
      0,
      (state) => state.curRound > atRound.curRound && Boolean(state.rounds[state.curRound + 1]?.isSwiss),
    );
    expectRedrawEquivalence(later, 0);
  });

  describe('FFA qual-table with a fixed draw, 43 players', () => {
    const config: SweepConfig = {
      label: 'ffa 43 fixed',
      count: 43,
      teams: false,
      setup: {
        ...FFA,
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        drawPublication: 'fixed',
      },
    };

    it('from a fixed pooling round: the fixed history entries stay untouched', () => {
      const atRound = playUntil(build(config), 0, (state) =>
        Boolean(state.rounds[state.curRound + 1]?.fixedRoomAssignments),
      );
      const first = advanceOk(scoreRound(atRound, 0, false));
      expect(first.roomHistory).toEqual(atRound.roomHistory);
      const redone = advanceOk(back(first));
      expect(redone.roomHistory).toEqual(atRound.roomHistory);
      expectRedrawEquivalence(atRound, 0, false);
    });

    it('into the first elimination round', () => {
      const atRound = playUntil(build(config), 0, (state) =>
        isFirstElimination(state.rounds[state.curRound + 1]),
      );
      expectRedrawEquivalence(atRound, 0);
    });
  });

  it('Kings Valley, 53 players: re-advance inside the ladder', () => {
    const config: SweepConfig = {
      label: 'kv 53',
      count: 53,
      teams: false,
      setup: { ...FFA, scheduleLogic: 'kings-valley', poolingPhase: 'none' },
    };
    const atRound = playUntil(build(config), 0, (state) =>
      Boolean(state.rounds[state.curRound]?.isKingsValley && state.rounds[state.curRound + 1]?.isKingsValley),
    );
    expectRedrawEquivalence(atRound, 0);
  });

  describe('head-to-head Group Stage, 37 players', () => {
    const config: SweepConfig = {
      label: 'group 37',
      count: 37,
      teams: false,
      setup: { ...H2H, scheduleLogic: 'single-elimination', poolingPhase: 'group-stage' },
    };

    it('from a group round into the next group round', () => {
      const atRound = playUntil(build(config), 0, (state) =>
        Boolean(state.rounds[state.curRound]?.isGroupStage && state.rounds[state.curRound + 1]?.isGroupStage),
      );
      expectRedrawEquivalence(atRound, 0, false);
    });

    it('from the last group round into the first elimination round', () => {
      const atRound = playUntil(build(config), 0, (state) =>
        Boolean(
          state.rounds[state.curRound]?.isGroupStage && isFirstElimination(state.rounds[state.curRound + 1]),
        ),
      );
      expectRedrawEquivalence(atRound, 0);
    });
  });
});

describe('Next Round steps forward unchanged when the drawn-ahead round is locked', () => {
  const config: SweepConfig = {
    label: 'ffa 37 none',
    count: 37,
    teams: false,
    setup: { ...FFA, scheduleLogic: 'single-elimination', poolingPhase: 'none' },
  };

  it.each([0, 2])(
    'two rounds back from round index %i: locked by scores in the middle round, then re-draws from the middle round',
    (index) => {
      const atRound = playUntil(build(config), 0, (state) => state.curRound === index);
      const afterFirst = advanceOk(scoreRound(atRound, 0, false));
      const afterSecond = advanceOk(scoreRound(afterFirst, 0, false));
      const twiceBack = { ...afterSecond, curRound: index };

      // Round index+1 has scores, so Next from index steps forward.
      expect(drawnAheadStatus(twiceBack, index)).toBe('locked');
      const stepped = advanceOk(twiceBack);
      expect(stepped.curRound).toBe(index + 1);
      expect(view(stepped)).toEqual(view({ ...twiceBack, curRound: index + 1 }));
      expect(stepped.scores).toEqual(twiceBack.scores);

      // Round index+2 is drawn but unscored, so Next from index+1 re-draws it identically.
      expect(drawnAheadStatus(stepped, index + 1)).toBe('redraw');
      expect(view(advanceOk(stepped))).toEqual(view(afterSecond));
    },
  );

  it('one score entered in the drawn-ahead round locks it: the state is otherwise identical, even after an edit in round 2', () => {
    const atRound = playUntil(build(config), 0, (state) => state.curRound === 2);
    const first = advanceOk(scoreRound(atRound, 0, false));
    const [firstKey] = scoreKeysForPosition({
      roundIndex: 3,
      room: 1,
      position: 0,
      numGames: first.rounds[3].numGames ?? 1,
    });
    // The edit would change a re-draw; locked, the old draw must stay.
    const edited = scoreRound(back(first), 0, true);
    const withScore = { ...edited, scores: { ...edited.scores, [firstKey]: 5 } };
    const stepped = advanceOk(withScore);
    expect(stepped.curRound).toBe(3);
    expect(stepped.assignments).toEqual(first.assignments);
    expect(stepped).toEqual({ ...withScore, curRound: 3, needsSave: true, reserveOpen: stepped.reserveOpen });
  });

  it('double elimination, 37 FFA players: steps forward; pools and lucky losers are untouched', () => {
    const state = build({
      label: 'de 37',
      count: 37,
      teams: false,
      setup: { ...FFA, scheduleLogic: 'double-elimination-shared-final', poolingPhase: 'none' },
    });
    expectLockedStepForward(state, 0);
  });

  it('double elimination, 1v1 with 37 players: steps forward; pools and lucky losers are untouched', () => {
    const state = build({
      label: 'de h2h 37',
      count: 37,
      teams: false,
      setup: { ...H2H, scheduleLogic: 'double-elimination', poolingPhase: 'none' },
    });
    expectLockedStepForward(state, 0);
  });

  it('waterfall (the 16-player example): steps forward; pools and lucky losers are untouched', () => {
    const example = WATERFALL_EXAMPLES.find((entry) => entry.id === 'second-chance-16');
    const state = build({
      label: 'waterfall 16',
      count: 16,
      teams: false,
      setup: {
        ...FFA,
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'qual-table',
        qualAdv: '16',
        waterfallGraph: example?.text ?? '',
      },
    });
    expectLockedStepForward(state, 0);
  });
});

/** Plays to the first bracket/waterfall round that has a next round, advances, goes back and advances again. */
function expectLockedStepForward(start: TournamentState, teamSize: number): void {
  const atRound = playUntil(start, teamSize, (state) => {
    const round = state.rounds[state.curRound];
    return Boolean(
      (round.bracket || round.isWaterfall) && !round.isFinal && state.rounds[state.curRound + 1],
    );
  });
  const first = advanceOk(scoreRound(atRound, teamSize, false));
  const backAgain = back(first);
  expect(drawnAheadStatus(backAgain, atRound.curRound)).toBe('locked');
  const stepped = advanceOk(backAgain);
  expect(stepped.curRound).toBe(atRound.curRound + 1);
  expect(stepped.pendingBracketSeeds).toEqual(backAgain.pendingBracketSeeds);
  expect(stepped.luckyLosers).toEqual(backAgain.luckyLosers);
  expect(view(stepped)).toEqual(view({ ...backAgain, curRound: atRound.curRound + 1 }));
}

describe('drawnAheadStatus', () => {
  const config: SweepConfig = {
    label: 'ffa 31 none',
    count: 31,
    teams: false,
    setup: { ...FFA, scheduleLogic: 'single-elimination', poolingPhase: 'none' },
  };

  it('is "none" before the next round is drawn', () => {
    const state = build(config);
    expect(drawnAheadStatus(state, 0)).toBe('none');
  });

  it('is "redraw" when the next round is drawn and nothing in it is scored', () => {
    const first = advanceOk(scoreRound(build(config), 0, false));
    expect(drawnAheadStatus(back(first), 0)).toBe('redraw');
  });

  it('is "locked" when a drawn later round has a score', () => {
    const first = advanceOk(scoreRound(build(config), 0, false));
    const second = advanceOk(scoreRound(first, 0, false));
    expect(drawnAheadStatus({ ...second, curRound: 0 }, 0)).toBe('locked');
  });

  it('is "locked" when the drawn Final has final scores', () => {
    const state = build(config);
    const finalIndex = state.rounds.length - 1;
    const drawn = {
      ...state,
      assignments: state.rounds.map(() => [{ name: 'P1', room: 1, isLucky: false }]),
    };
    expect(drawnAheadStatus(drawn, finalIndex - 1)).toBe('redraw');
    const scored = { ...drawn, finalScores: { 'game1-P1': 10 } };
    expect(drawnAheadStatus(scored, finalIndex - 1)).toBe('locked');
  });

  it('is "locked" when the round advanced from is double elimination or waterfall', () => {
    const state = build(config);
    const drawn = { ...state, assignments: [state.assignments[0], state.assignments[0]] };
    for (const flag of [{ bracket: 'WB' }, { isWaterfall: true }] as const) {
      const rounds = state.rounds.map((round, index) => (index === 0 ? { ...round, ...flag } : round));
      expect(drawnAheadStatus({ ...drawn, rounds } as TournamentState, 0)).toBe('locked');
    }
  });
});

describe('discardDrawsAfter', () => {
  it('leaves the draws up to the round advanced from and the input state alone', () => {
    const start = build({
      label: 'ffa 37 none',
      count: 37,
      teams: false,
      setup: { ...FFA, scheduleLogic: 'single-elimination', poolingPhase: 'none' },
    });
    const first = advanceOk(scoreRound(start, 0, false));
    const second = advanceOk(scoreRound(first, 0, false));
    const snapshot = structuredClone(second);
    const discarded = discardDrawsAfter(second, 0);
    expect(second).toEqual(snapshot);
    expect(discarded.assignments).toEqual([start.assignments[0]]);
    expect(discarded.roomHistory).toEqual(start.roomHistory);
  });
});
