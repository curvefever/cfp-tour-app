import { describe, expect, it } from 'vitest';
import { replayBracketPools } from '../bracket-replay';
import { removeRosterUnit, swapIndividual } from '../mutations';
import { currentColumn } from '../round-columns';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';
import { ALL_ROUTED_GRAPHS, QUAL_GRAPH, buildQualWaterfall } from './qual-waterfall';

/**
 * The pools of units waiting for a round not drawn yet (and the double elimination lucky losers) are a pure
 * function of the recorded results: replaying every advance reproduces what the real advances stored.
 */

const FFA = { gameFormat: 'ffa-individual' } as const;

const DE_RACE_37: SweepConfig = {
  label: 'de race 37',
  count: 37,
  teams: false,
  setup: {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'double-elimination',
    poolingPhase: 'none',
    oddCountStrategy: 'bye',
  },
};

const DE_SHARED_FINAL_37: SweepConfig = {
  label: 'de shared final 37',
  count: 37,
  teams: false,
  setup: { ...FFA, scheduleLogic: 'double-elimination-shared-final', poolingPhase: 'none' },
};

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

function waterfallConfig(id: string, count: number): SweepConfig {
  const example = WATERFALL_EXAMPLES.find((entry) => entry.id === id);
  return {
    label: `waterfall ${id}`,
    count,
    teams: false,
    setup: {
      ...FFA,
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: String(count),
      waterfallGraph: example?.text ?? '',
    },
  };
}

function build(config: SweepConfig): TournamentState {
  const state = buildState(config);
  if (!state) throw new Error(`generation refused: ${config.label}`);
  return state;
}

/** Scores every round of the column in play, every score distinct. */
function scoreColumn(state: TournamentState): TournamentState {
  const { start, end } = currentColumn(state);
  let scored = state;
  for (let index = start; index <= end; index += 1) {
    scored = { ...scoreCurrentRound({ ...scored, curRound: index }, 0), curRound: state.curRound };
  }
  return scored;
}

/**
 * Checks the replay against every pool and lucky list of a round not drawn yet (a drawn round's pool was
 * emptied when it was drawn); returns how many pools it compared that held units.
 */
function expectReplayMatches(state: TournamentState): number {
  const { start, end } = currentColumn(state);
  const replay = replayBracketPools(state, start);
  const pooled = new Set([...replay.pools.keys(), ...Object.keys(state.pendingBracketSeeds).map(Number)]);
  let compared = 0;
  for (const destination of pooled) {
    if (destination <= end) continue;
    const actual = state.pendingBracketSeeds[destination] ?? [];
    expect(replay.pools.get(destination) ?? [], `pool of round ${destination}`).toEqual(actual);
    if (actual.length > 0) compared += 1;
  }
  const lucky = new Set([...replay.lucky.keys(), ...state.luckyLosers.keys()]);
  for (const destination of lucky) {
    if (destination <= end) continue;
    expect(replay.lucky.get(destination) ?? [], `lucky losers of round ${destination}`).toEqual(
      state.luckyLosers[destination] ?? [],
    );
  }
  return compared;
}

/** Scores and advances until the tournament cannot go further, checking the replay after every advance. */
function playAndCheck(start: TournamentState): { compared: number; state: TournamentState; status: string } {
  let state = start;
  let compared = 0;
  for (let guard = 0; guard < 80; guard += 1) {
    const result = advanceTournamentRound(scoreColumn(state));
    if (result.status !== 'advanced') return { compared, state, status: result.status };
    state = result.state;
    compared += expectReplayMatches(state);
  }
  throw new Error('the tournament did not end');
}

function poolOf(state: TournamentState, destination: number): string[] {
  return (state.pendingBracketSeeds[destination] ?? []).map((seed) => seed.name);
}

/** Plays until a round not drawn yet has a unit waiting, and returns that state and the first such unit. */
function playToFarPool(start: TournamentState): {
  state: TournamentState;
  destination: number;
  name: string;
} {
  let state = start;
  for (let guard = 0; guard < 80; guard += 1) {
    const { end } = currentColumn(state);
    const destination = Object.keys(state.pendingBracketSeeds)
      .map(Number)
      .find((index) => index > end && poolOf(state, index).length > 0);
    if (destination !== undefined) return { state, destination, name: poolOf(state, destination)[0] };
    const result = advanceTournamentRound(scoreColumn(state));
    if (result.status !== 'advanced') break;
    state = result.state;
  }
  throw new Error('no unit ever waited for a later round');
}

const FORMATS: Array<[string, () => TournamentState]> = [
  ['double elimination race 1v1, 37 players (byes)', () => build(DE_RACE_37)],
  ['double elimination shared final FFA, 37 players (lucky losers)', () => build(DE_SHARED_FINAL_37)],
  ['double elimination shared final after a qualification table, 37 players', () => build(DE_AFTER_QUAL)],
  ['waterfall second-chance-16', () => build(waterfallConfig('second-chance-16', 16))],
  ['waterfall spreadsheet-32 (simultaneous columns)', () => build(waterfallConfig('spreadsheet-32', 32))],
  [
    'waterfall with a Qual source, 43 players, rounds played one at a time',
    () => buildQualWaterfall(43, QUAL_GRAPH),
  ],
  [
    'waterfall with a Qual source, 43 players, columns stored',
    () => buildQualWaterfall(43, QUAL_GRAPH, {}, { columns: true }),
  ],
];

describe('the replay reproduces the pools after every advance', () => {
  it.each(FORMATS)('%s', (_name, start) => {
    const played = playAndCheck(start());
    expect(['noop']).toContain(played.status);
    expect(played.compared).toBeGreaterThan(0);
  });
});

describe('the replay follows a withdrawal and a swap of a unit waiting in a far pool', () => {
  // The second Qual graph routes every unit, so nobody is eliminated and the swap window stays open
  // while R1C waits in a pool.
  const SWAPPABLE: Array<[string, () => TournamentState]> = [
    ['double elimination race 1v1, 37 players', () => build(DE_RACE_37)],
    ['double elimination shared final FFA, 37 players', () => build(DE_SHARED_FINAL_37)],
    [
      'waterfall with a Qual source routing every unit, 43 players',
      () => buildQualWaterfall(43, ALL_ROUTED_GRAPHS[43]),
    ],
  ];
  const WITHDRAWABLE: Array<[string, () => TournamentState]> = [
    ...SWAPPABLE,
    ['waterfall spreadsheet-32', () => build(waterfallConfig('spreadsheet-32', 32))],
  ];

  it.each(WITHDRAWABLE)('%s: a withdrawn unit is dropped', (_name, start) => {
    const { state, destination, name } = playToFarPool(start());
    const removed = removeRosterUnit(state, name);
    expect(poolOf(removed, destination)).not.toContain(name);
    expect(expectReplayMatches(removed)).toBeGreaterThan(0);
    const replayed = replayBracketPools(removed, currentColumn(removed).start).pools.get(destination);
    expect(replayed?.map((seed) => seed.name)).not.toContain(name);
    playAndCheck(removed);
  });

  it.each(SWAPPABLE)('%s: a swapped unit is its replacement', (_name, start) => {
    const { state, destination, name } = playToFarPool(start());
    const swapped = swapIndividual(state, name, 'Sub');
    // A closed swap window (a unit already eliminated) would leave the state as it was and prove nothing.
    expect(swapped).not.toBe(state);
    expect(poolOf(swapped, destination)).toContain('Sub');
    expect(expectReplayMatches(swapped)).toBeGreaterThan(0);
    const replayed = replayBracketPools(swapped, currentColumn(swapped).start).pools.get(destination);
    expect(replayed?.map((seed) => seed.name)).toContain('Sub');
    expect(replayed?.map((seed) => seed.name)).not.toContain(name);
    playAndCheck(swapped);
  });
});
