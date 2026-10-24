import { describe, expect, it } from 'vitest';
import { removeRosterUnit, swapIndividual, swapWindowOpen } from '../mutations';
import { discardDrawsAfter, drawnAheadStatus } from '../redraw';
import { currentColumn, nextColumnStart, previousColumnStart } from '../round-columns';
import { scoreKeysForPosition } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';
import { ALL_ROUTED_GRAPHS, QUAL_GRAPH, buildQualWaterfall } from './qual-waterfall';
import { spreadConfig, startSpread } from './spread-play';

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
  'pendingBracketSeeds',
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

/** Previous: back to the first round of the column before the one in play. */
function back(state: TournamentState): TournamentState {
  return { ...state, curRound: previousColumnStart(state) ?? state.curRound - 1 };
}

/** Scores every round of the column in play; `reversed` flips every room's order, which changes who advances. */
function scoreRound(state: TournamentState, teamSize: number, reversed: boolean): TournamentState {
  const { start, end } = currentColumn(state);
  let scored = state;
  for (let index = start; index <= end; index += 1) {
    scored = {
      ...scoreOneRound({ ...scored, curRound: index }, teamSize, reversed),
      curRound: state.curRound,
    };
  }
  return scored;
}

function scoreOneRound(state: TournamentState, teamSize: number, reversed: boolean): TournamentState {
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
function expectRedrawEquivalence(
  atRound: TournamentState,
  teamSize: number,
  editChangesDraw = true,
  poolsMayCarryIt = false,
): void {
  // No edit: the re-draw reproduces the first advance exactly.
  const next = nextColumnStart(atRound);
  const first = advanceOk(scoreRound(atRound, teamSize, false));
  expect(first.assignments[next]?.length).toBeGreaterThan(0);
  expect(view(advanceOk(back(first)))).toEqual(view(first));

  // A score edit in the round advanced from: the re-draw equals advancing the corrected state.
  const expected = advanceOk(scoreRound(atRound, teamSize, true));
  const redone = advanceOk(scoreRound(back(first), teamSize, true));
  expect(view(redone)).toEqual(view(expected));
  // The edit must really change the next draw, or the check proves nothing.
  if (editChangesDraw) {
    // A correction in a bracket round may only move units into a round drawn later: its pools show it.
    const poolsChanged =
      poolsMayCarryIt &&
      JSON.stringify(redone.pendingBracketSeeds) !== JSON.stringify(first.pendingBracketSeeds);
    if (!poolsChanged) expect(redone.assignments[next]).not.toEqual(first.assignments[next]);
  }
}

const FFA = { gameFormat: 'ffa-individual' } as const;
const H2H = { gameFormat: 'individual-1v1', oddCountStrategy: 'bye' } as const;

const DE_AFTER_QUAL: SweepConfig = {
  label: 'de shared final 37 qual-table',
  count: 37,
  teams: false,
  setup: {
    ...FFA,
    scheduleLogic: 'double-elimination-shared-final',
    poolingPhase: 'qual-table',
    qualAdv: '16',
  },
};

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

  it('FFA qualification table, 37 players: re-advance into a counted round whose rooms differ in size', () => {
    const atRound = playUntil(startSpread(spreadConfig('ffa', 37)), 0, (state) => state.curRound === 1);
    expect(atRound.rounds[atRound.curRound + 1].rooms).toEqual([8, 8, 7, 7, 7]);
    expectRedrawEquivalence(atRound, 0);
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
        qualAdv: '24',
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

  it('double elimination after a qual-table, 37 FFA players: re-advance from the last pooling round into the first winners round', () => {
    const atRound = playUntil(build(DE_AFTER_QUAL), 0, (state) =>
      Boolean(state.rounds[state.curRound + 1]?.bracket),
    );
    expect(atRound.rounds[atRound.curRound].isQual).toBe(true);
    expectRedrawEquivalence(atRound, 0);
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
    expect(stepped).toEqual({ ...withScore, curRound: 3, reserveOpen: stepped.reserveOpen });
  });
});

type Stop = (state: TournamentState) => boolean;

const isBracketRound: Stop = (state) => {
  const round = state.rounds[state.curRound];
  return Boolean(
    (round.bracket || round.isWaterfall) && !round.isFinal && state.rounds[nextColumnStart(state)],
  );
};

/** The first unit waiting in the pool of a round after the column in play, with that round. */
function farPoolUnit(state: TournamentState): { name: string; destination: number } | null {
  const { end } = currentColumn(state);
  for (const [key, seeds] of Object.entries(state.pendingBracketSeeds)) {
    if (Number(key) > end && seeds.length > 0) return { name: seeds[0].name, destination: Number(key) };
  }
  return null;
}

/** A bracket round reached while later rounds' pools already hold units from earlier rounds. */
const withFarPool: Stop = (state) => isBracketRound(state) && farPoolUnit(state) !== null;
const atLabel =
  (label: string): Stop =>
  (state) =>
    state.rounds[state.curRound].customLabel === label;

const DE_RACE_37: SweepConfig = {
  label: 'de h2h 37',
  count: 37,
  teams: false,
  setup: { ...H2H, scheduleLogic: 'double-elimination', poolingPhase: 'none' },
};
const DE_SHARED_FINAL_37: SweepConfig = {
  label: 'de 37',
  count: 37,
  teams: false,
  setup: { ...FFA, scheduleLogic: 'double-elimination-shared-final', poolingPhase: 'none' },
};

function waterfallExample(id: string, count: number): SweepConfig {
  return {
    label: `waterfall ${id}`,
    count,
    teams: false,
    setup: {
      ...FFA,
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: String(count),
      waterfallGraph: WATERFALL_EXAMPLES.find((entry) => entry.id === id)?.text ?? '',
    },
  };
}

/** Its first round routes every unit on, so nobody is eliminated until the second column. */
const SWAP_WATERFALL_16: SweepConfig = {
  label: 'waterfall nobody out in R1',
  count: 16,
  teams: false,
  setup: {
    ...FFA,
    scheduleLogic: 'waterfall-bracket',
    poolingPhase: 'qual-table',
    qualAdv: '16',
    waterfallGraph: `
ROUNDS:
R1 = 2x8
R2 = 8 COLUMN 2
R3 = 8 COLUMN 3
Final = 8 FINAL

ROUTES:
R1.A: 1-4->R2, 5-8->R3
R1.B: 1-4->R2, 5-8->R3
R2: 1-4->Final, 5-8->eliminated
R3: 1-4->Final, 5-8->eliminated
`,
  },
};

const FIRST_AND_LATER: Array<[string, Stop]> = [
  ['first bracket round', isBracketRound],
  ['later round, pools already hold units', withFarPool],
];

const REDRAW_CASES: Array<{ name: string; start: () => TournamentState; stops: Array<[string, Stop]> }> = [
  { name: 'double elimination race 1v1, 37 players', start: () => build(DE_RACE_37), stops: FIRST_AND_LATER },
  {
    name: 'double elimination shared final FFA, 37 players',
    start: () => build(DE_SHARED_FINAL_37),
    stops: FIRST_AND_LATER,
  },
  {
    name: 'double elimination shared final after a qualification table, 37 players',
    start: () => build(DE_AFTER_QUAL),
    stops: FIRST_AND_LATER,
  },
  {
    name: 'waterfall second-chance-16',
    start: () => build(waterfallExample('second-chance-16', 16)),
    stops: FIRST_AND_LATER,
  },
  {
    name: 'waterfall spreadsheet-32 (simultaneous columns)',
    start: () => build(waterfallExample('spreadsheet-32', 32)),
    stops: [
      ['first column (R5)', atLabel('R5')],
      ['column of three rounds (SemiA, R6B, R6C)', atLabel('SemiA')],
      ['column after it, SemiB waiting in a pool (R7A)', atLabel('R7A')],
    ],
  },
  {
    name: 'waterfall with a Qual source, 43 players',
    start: () => buildQualWaterfall(43, QUAL_GRAPH, {}, { columns: true }),
    stops: FIRST_AND_LATER,
  },
];

const REDRAW_STOPS = REDRAW_CASES.flatMap(({ name, start, stops }) =>
  stops.map(([depth, stop], index) => ({ name: `${name}, ${depth}`, start, stop, first: index === 0 })),
);

describe('Next Round re-draws a corrected double elimination or waterfall round', () => {
  it.each(REDRAW_STOPS)(
    '$name: no edit reproduces the advance, a correction re-routes',
    ({ start, stop }) => {
      const atRound = playUntil(start(), 0, stop);
      expect(drawnAheadStatus(back(advanceOk(scoreRound(atRound, 0, false))), atRound.curRound)).toBe(
        'redraw',
      );
      expectRedrawEquivalence(atRound, 0, true, true);
    },
  );

  it('the Grand Final names the finalist of the corrected winners final', () => {
    const atRound = playUntil(
      build(DE_RACE_37),
      0,
      (state) => state.rounds[state.rounds[state.curRound].winnersTo ?? -1]?.bracket === 'grand-final',
    );
    const grandFinal = atRound.rounds[atRound.curRound].winnersTo as number;
    const first = advanceOk(scoreRound(atRound, 0, false));
    const redone = advanceOk(scoreRound(back(first), 0, true));
    const expected = advanceOk(scoreRound(atRound, 0, true));
    expect(view(redone)).toEqual(view(expected));
    // The Grand Final is drawn once the losers final is played: play on from each version to it.
    const finalist = (state: TournamentState) =>
      playUntil(state, 0, (reached) => reached.curRound === grandFinal).rounds[grandFinal].wbFinalistName;
    expect(finalist(redone)).toBeDefined();
    expect(finalist(redone)).toBe(finalist(expected));
    expect(finalist(redone)).not.toBe(finalist(first));
  });

  it('correcting the last qualification round re-draws with empty waterfall pools', () => {
    const atRound = playUntil(buildQualWaterfall(43, QUAL_GRAPH, {}, { columns: true }), 0, (state) =>
      Boolean(state.rounds[nextColumnStart(state)]?.isWaterfall),
    );
    expect(atRound.rounds[atRound.curRound].isQual).toBe(true);
    expect(Object.values(advanceOk(scoreRound(atRound, 0, false)).pendingBracketSeeds).flat()).toEqual([]);
    expectRedrawEquivalence(atRound, 0);
  });

  describe('a withdrawal or a swap between the advance and the correction', () => {
    /**
     * The room history of a withdrawn unit's pairings is not compared: re-drawing rewinds it from the
     * line-ups, which no longer hold the unit, while a withdrawal before the advance leaves it as recorded.
     */
    function viewWithout(state: TournamentState, gone: string | null) {
      const kept = Object.entries(state.roomHistory).filter(
        ([pair]) => !pair.split('|').includes(gone ?? ''),
      );
      return { ...view(state), roomHistory: Object.fromEntries(kept) };
    }

    /** Applies the change after the advance (then goes back) and before it: the corrected re-draw must agree. */
    function expectSameAsAdvancingFromChanged(
      atRound: TournamentState,
      change: (state: TournamentState) => TournamentState,
      gone: string | null,
    ): void {
      const first = advanceOk(scoreRound(atRound, 0, false));
      const changed = change(back(first));
      expect(drawnAheadStatus(changed, atRound.curRound)).toBe('redraw');
      const redone = advanceOk(scoreRound(changed, 0, true));
      const expected = advanceOk(scoreRound(change(atRound), 0, true));
      expect(viewWithout(redone, gone)).toEqual(viewWithout(expected, gone));
    }

    const WITHDRAWABLE: Array<{ name: string; start: () => TournamentState }> = [
      { name: 'double elimination race 1v1, 37 players', start: () => build(DE_RACE_37) },
      { name: 'double elimination shared final FFA, 37 players', start: () => build(DE_SHARED_FINAL_37) },
      {
        name: 'waterfall with a Qual source routing every unit, 43 players (R1C waits)',
        start: () => buildQualWaterfall(43, ALL_ROUTED_GRAPHS[43]),
      },
      { name: 'waterfall spreadsheet-32', start: () => build(waterfallExample('spreadsheet-32', 32)) },
    ];

    it.each(WITHDRAWABLE)('$name: a unit waiting in a far pool withdraws', ({ start }) => {
      const atRound = playUntil(start(), 0, withFarPool);
      const name = farPoolUnit(atRound)?.name as string;
      expectSameAsAdvancingFromChanged(atRound, (state) => removeRosterUnit(state, name), name);
    });

    // A swap needs the window still open after the advance, so the round advanced from eliminates nobody.
    const keepsSwapWindowOpen: Stop = (state) => {
      if (!isBracketRound(state)) return false;
      const advanced = advanceOk(scoreRound(state, 0, false));
      return swapWindowOpen(advanced) && farPoolUnit(advanced) !== null;
    };
    const SWAPPABLE: Array<{ name: string; start: () => TournamentState }> = [
      { name: 'double elimination race 1v1, 37 players', start: () => build(DE_RACE_37) },
      { name: 'double elimination shared final FFA, 37 players', start: () => build(DE_SHARED_FINAL_37) },
      {
        name: 'waterfall whose first round eliminates nobody, 16 players',
        start: () => build(SWAP_WATERFALL_16),
      },
    ];

    it.each(SWAPPABLE)('$name: a unit waiting in a pool is swapped', ({ start }) => {
      const atRound = playUntil(start(), 0, keepsSwapWindowOpen);
      const first = advanceOk(scoreRound(atRound, 0, false));
      const name = farPoolUnit(first)?.name as string;
      const swap = (state: TournamentState) => swapIndividual(state, name, 'Sub');
      expect(swap(back(first))).not.toEqual(back(first));
      expectSameAsAdvancingFromChanged(atRound, swap, null);
    });

    it.each(REDRAW_STOPS.filter(({ first }) => first))(
      '$name: a unit drawn into the next round withdraws, so the re-advance fits it short',
      ({ start, stop }) => {
        const atRound = playUntil(start(), 0, stop);
        const next = nextColumnStart(atRound);
        const first = advanceOk(scoreRound(atRound, 0, false));
        const name = first.assignments[next].find((entry) => entry.room !== null)?.name as string;
        expectSameAsAdvancingFromChanged(atRound, (state) => removeRosterUnit(state, name), name);
        const redone = advanceOk(scoreRound(removeRosterUnit(back(first), name), 0, true));
        const seats = redone.rounds[next].rooms.reduce((total, size) => total + size, 0);
        expect(seats).toBe(redone.assignments[next].filter((entry) => entry.room !== null).length);
      },
    );
  });

  describe('when the recorded results do not explain the pools', () => {
    // A unit waiting from before the round advanced from; one that came from it is re-sent by the re-draw.
    const waitsPastNextRound: Stop = (state) =>
      isBracketRound(state) &&
      Object.entries(state.pendingBracketSeeds).some(
        ([index, seeds]) => Number(index) > nextColumnStart(state) && seeds.length > 0,
      );
    const atRound = playUntil(build(DE_RACE_37), 0, waitsPastNextRound);
    const first = advanceOk(scoreRound(atRound, 0, false));
    const destination = Object.keys(atRound.pendingBracketSeeds)
      .map(Number)
      .find(
        (index) => index > nextColumnStart(atRound) && atRound.pendingBracketSeeds[index].length > 0,
      ) as number;
    const waiting = first.pendingBracketSeeds[destination];
    const name = waiting[0].name;

    function expectSteppedForwardUnchanged(pools: TournamentState['pendingBracketSeeds']): void {
      const backAgain = back({ ...first, pendingBracketSeeds: { ...first.pendingBracketSeeds, ...pools } });
      expect(drawnAheadStatus(backAgain, atRound.curRound)).toBe('locked');
      const stepped = advanceOk(backAgain);
      expect(stepped.curRound).toBe(nextColumnStart(atRound));
      expect(stepped.pendingBracketSeeds).toEqual(backAgain.pendingBracketSeeds);
      expect(view(stepped)).toEqual(view({ ...backAgain, curRound: nextColumnStart(atRound) }));
    }

    it('the untouched state re-draws', () => {
      expect(drawnAheadStatus(back(first), atRound.curRound)).toBe('redraw');
    });

    it('a unit dropped from a pool: steps forward unchanged', () => {
      expectSteppedForwardUnchanged({ [destination]: waiting.filter((seed) => seed.name !== name) });
    });

    it('a unit added to a pool twice: steps forward unchanged', () => {
      const seed = waiting.find((entry) => entry.name === name) as (typeof waiting)[number];
      expectSteppedForwardUnchanged({ [destination]: [...waiting, seed] });
    });
  });

  it.each([
    ['double elimination', () => build(DE_SHARED_FINAL_37)],
    ['waterfall', () => build(waterfallExample('second-chance-16', 16))],
  ])('%s: a score in the drawn-ahead round locks it', (_name, start) => {
    const atRound = playUntil(start(), 0, isBracketRound);
    const first = advanceOk(scoreRound(atRound, 0, false));
    const next = nextColumnStart(atRound);
    const [key] = scoreKeysForPosition({
      roundIndex: next,
      room: 1,
      position: 0,
      numGames: first.rounds[next].numGames ?? 1,
    });
    const withScore = { ...first, scores: { ...first.scores, [key]: 5 } };
    expect(drawnAheadStatus(back(withScore), atRound.curRound)).toBe('locked');
    const stepped = advanceOk(back(withScore));
    expect(stepped.curRound).toBe(next);
    expect(stepped.assignments).toEqual(first.assignments);
  });
});

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

  it('is "redraw" when the round advanced from is double elimination or waterfall and the pools are explained', () => {
    const state = build(config);
    const drawn = { ...state, assignments: [state.assignments[0], state.assignments[0]] };
    for (const flag of [{ bracket: 'WB' }, { isWaterfall: true }] as const) {
      const rounds = state.rounds.map((round, index) => (index === 0 ? { ...round, ...flag } : round));
      expect(drawnAheadStatus({ ...drawn, rounds } as TournamentState, 0)).toBe('redraw');
    }
  });

  it('is "locked" when a drawn round holds a unit the recorded results do not explain', () => {
    const state = build(config);
    // Round 1 is drawn with a unit round 0 never held, which no replay of the rounds before 0 can explain.
    const drawn = { ...state, assignments: [state.assignments[0].slice(1), state.assignments[0]] };
    const rounds = state.rounds.map((round, index) =>
      index === 0 ? { ...round, isWaterfall: true } : round,
    );
    expect(drawnAheadStatus({ ...drawn, rounds }, 0)).toBe('locked');
  });

  it('is "redraw" when a double elimination round between the current and the last drawn round was advanced from', () => {
    const start = build(DE_AFTER_QUAL);
    const atRound = playUntil(start, 0, (state) => Boolean(state.rounds[state.curRound + 1]?.bracket));
    const r = atRound.curRound;
    const drawnOnce = { ...atRound, assignments: [...atRound.assignments, atRound.assignments[r]] };
    expect(drawnAheadStatus(drawnOnce, r)).toBe('redraw');
    const drawnTwice = { ...drawnOnce, assignments: [...drawnOnce.assignments, atRound.assignments[r]] };
    expect(drawnAheadStatus(drawnTwice, r)).toBe('redraw');
  });
});

describe('discardDrawsAfter', () => {
  const config: SweepConfig = {
    label: 'ffa 37 none',
    count: 37,
    teams: false,
    setup: { ...FFA, scheduleLogic: 'single-elimination', poolingPhase: 'none' },
  };

  it('leaves the draws up to the round advanced from and the input state alone', () => {
    const start = build(config);
    const first = advanceOk(scoreRound(start, 0, false));
    const second = advanceOk(scoreRound(first, 0, false));
    const snapshot = structuredClone(second);
    const discarded = discardDrawsAfter(second, 0);
    expect(second).toEqual(snapshot);
    expect(discarded.assignments).toEqual([start.assignments[0]]);
    expect(discarded.roomHistory).toEqual(start.roomHistory);
  });

  it('clears the byes, lucky losers, pooling-bye counts and tie resolutions of every discarded round, and keeps the kept round entries', () => {
    const first = advanceOk(scoreRound(build(config), 0, false));
    const second = advanceOk(scoreRound(first, 0, false));
    // Round 1 is a warm-up (its bye was counted); round 2 is the first elimination round.
    const seeded: TournamentState = {
      ...second,
      byes: second.byes.map((round, index) => (index === 1 ? ['X'] : index === 2 ? ['Y'] : round)),
      luckyLosers: second.luckyLosers.map((round, index) => (index === 1 || index === 2 ? ['Z'] : round)),
      poolingByeCounts: { X: 1 },
      tieResolutions: { 'r0-rm1-s5': ['A'], 'r1-rm1-s5': ['B'], 'r2-rm1-s5': ['C'] },
    };
    const discarded = discardDrawsAfter(seeded, 0);
    expect(discarded.byes[1]).toEqual([]);
    expect(discarded.byes[2]).toEqual([]);
    expect(discarded.luckyLosers[1]).toEqual([]);
    expect(discarded.luckyLosers[2]).toEqual([]);
    expect(discarded.poolingByeCounts).toEqual({});
    expect(discarded.tieResolutions).toEqual({ 'r0-rm1-s5': ['A'] });
  });
});
