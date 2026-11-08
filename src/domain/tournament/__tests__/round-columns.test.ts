import { describe, expect, it } from 'vitest';
import {
  currentColumn,
  isCurrentRound,
  isRoundDone,
  isRoundReached,
  nextColumnStart,
  previousColumnStart,
  roundColumn,
  roundsInPlay,
  undrawnRounds,
  usesDependencyPlay,
} from '../round-columns';
import type { TournamentRound, WaterfallStep } from '../types';
import { buildRound } from './test-fixtures';
import { withDependencyPlay } from './qual-waterfall';

/** Rounds 0 and 1 on their own (no stored column), a column of 2 (2-3), a column of 3 (4-6), a single column round (7). */
const COLUMN_OF_BY_INDEX = [undefined, undefined, 1, 1, 2, 2, 2, 3];
const COLUMNED = COLUMN_OF_BY_INDEX.map((waterfallColumn, index) =>
  buildRound({ roundNum: index + 1, waterfallColumn }),
);
const PLAIN = COLUMN_OF_BY_INDEX.map((_, index) => buildRound({ roundNum: index + 1 }));

function stateAt(rounds: typeof COLUMNED, curRound: number) {
  return { rounds, curRound };
}

describe('roundColumn', () => {
  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 3],
    [3, 2, 3],
    [4, 4, 6],
    [5, 4, 6],
    [6, 4, 6],
    [7, 7, 7],
  ])('puts round %i in the run %i-%i', (index, start, end) => {
    expect(roundColumn(COLUMNED, index)).toEqual({ start, end });
  });

  it('makes every round its own column when none has a stored column', () => {
    PLAIN.forEach((_, index) => expect(roundColumn(PLAIN, index)).toEqual({ start: index, end: index }));
  });

  it('keeps two neighbouring columns apart and reads an index past the rounds as a column of its own', () => {
    expect(roundColumn(COLUMNED, 3)).toEqual({ start: 2, end: 3 });
    expect(roundColumn(COLUMNED, 99)).toEqual({ start: 99, end: 99 });
  });
});

describe('the column in play', () => {
  it('is the run of curRound, and curRound is its first round', () => {
    expect(currentColumn(stateAt(COLUMNED, 4))).toEqual({ start: 4, end: 6 });
  });

  it.each([
    [4, [4, 5, 6]],
    [2, [2, 3]],
    [0, [0]],
    [7, [7]],
  ])('with curRound %i, rounds %j are current', (curRound, current) => {
    const state = stateAt(COLUMNED, curRound);
    COLUMNED.forEach((_, index) => expect(isCurrentRound(state, index)).toBe(current.includes(index)));
  });

  it('counts a round as reached up to the end of the column and done before its start', () => {
    const state = stateAt(COLUMNED, 2);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => isRoundReached(state, index))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => isRoundDone(state, index))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('finds the next and the previous column from any round of the column in play', () => {
    expect(nextColumnStart(stateAt(COLUMNED, 2))).toBe(4);
    expect(previousColumnStart(stateAt(COLUMNED, 2))).toBe(1);
    expect(nextColumnStart(stateAt(COLUMNED, 4))).toBe(7);
    expect(previousColumnStart(stateAt(COLUMNED, 4))).toBe(2);
    expect(nextColumnStart(stateAt(COLUMNED, 7))).toBe(8);
    expect(previousColumnStart(stateAt(COLUMNED, 7))).toBe(4);
    expect(previousColumnStart(stateAt(COLUMNED, 0))).toBeNull();
  });

  it('behaves exactly like curRound when no round has a stored column', () => {
    PLAIN.forEach((_, curRound) => {
      const state = stateAt(PLAIN, curRound);
      PLAIN.forEach((__, index) => {
        expect(isCurrentRound(state, index)).toBe(index === curRound);
        expect(isRoundReached(state, index)).toBe(index <= curRound);
        expect(isRoundDone(state, index)).toBe(index < curRound);
      });
      expect(nextColumnStart(state)).toBe(curRound + 1);
      expect(previousColumnStart(state)).toBe(curRound > 0 ? curRound - 1 : null);
    });
  });
});

/**
 * Dependency play on a three-chain graph: a pooling round (0), then the chains U1 U2 U3 (1, 3, 5) and L1 L2 L3 (2, 4, 6)
 * in the columns [U1, L1] [U2, L2] [U3, L3]. Only the state's steps decide what is reached, so a test lists them.
 */
const CHAIN_LABELS = ['Pool', 'U1', 'L1', 'U2', 'L2', 'U3', 'L3'];
const CHAIN_COLUMNS = [undefined, 1, 1, 2, 2, 3, 3];
const CHAIN_ROUNDS: TournamentRound[] = CHAIN_LABELS.map((customLabel, index) =>
  buildRound({
    roundNum: index + 1,
    customLabel,
    waterfallColumn: CHAIN_COLUMNS[index],
    isWaterfall: index > 0 ? true : undefined,
  }),
);
const U1 = 1;
const L1 = 2;
const U2 = 3;
const L2 = 4;
const U3 = 5;
const L3 = 6;

function dependencyState(steps: WaterfallStep[], curRound: number) {
  return withDependencyPlay({ rounds: CHAIN_ROUNDS, curRound, gamemodeConfig: {}, waterfallSteps: steps });
}

describe('dependency play: reached rounds are not a prefix of the rounds', () => {
  // U1 and L1 sent on, which drew L2 (U2 waits on a slower feeder); L2 sent on, which drew L3.
  const steps: WaterfallStep[] = [
    { sent: [U1, L1], drew: [L2] },
    { sent: [L2], drew: [L3] },
  ];
  const state = dependencyState(steps, L3);

  it('reads L3 as in play while U2 and U3 are undrawn, though both come before it', () => {
    expect(usesDependencyPlay(state)).toBe(true);
    expect(roundsInPlay(state)).toEqual([L3]);
    expect(isRoundReached(state, L3)).toBe(true);
    expect(isRoundReached(state, U2)).toBe(false);
    expect(isRoundReached(state, U3)).toBe(false);
    expect(isCurrentRound(state, L3)).toBe(true);
    expect(isCurrentRound(state, U2)).toBe(false);
  });

  it('counts the pooling round, the entry column and every round a step sent on as done', () => {
    expect([0, U1, L1, U2, L2, U3, L3].map((index) => isRoundDone(state, index))).toEqual([
      true,
      true,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it('lists the rounds not reached yet, in order', () => {
    expect(undrawnRounds(state)).toEqual([U2, U3]);
  });

  it('puts the entry column in play before any press, with nothing else reached', () => {
    const entry = dependencyState([], U1);
    expect(roundsInPlay(entry)).toEqual([U1, L1]);
    expect(undrawnRounds(entry)).toEqual([U2, L2, U3, L3]);
    expect(isRoundDone(entry, 0)).toBe(true);
  });

  it('keeps several rounds in play at once, in order, curRound the lowest', () => {
    // U1 sent alone drew U2; L1 is still being played.
    const several = dependencyState([{ sent: [U1], drew: [U2] }], L1);
    expect(roundsInPlay(several)).toEqual([L1, U2]);
    expect(undrawnRounds(several)).toEqual([L2, U3, L3]);
  });

  it('keeps a round of a reopened step reached and in play again, its drawn rounds reached too', () => {
    const reopened = dependencyState(
      [
        { sent: [U1, L1], drew: [L2] },
        { sent: [L2], drew: [L3], reopened: true },
      ],
      L2,
    );
    expect(roundsInPlay(reopened)).toEqual([L2, L3]);
    expect(isRoundDone(reopened, L2)).toBe(false);
    expect(isRoundReached(reopened, L3)).toBe(true);
  });

  it('reads a step stored without its empty drew list as drawing nothing', () => {
    const noDrew = dependencyState([{ sent: [U1, L1] } as WaterfallStep], U2);
    expect(roundsInPlay(noDrew)).toEqual([]);
    expect(isRoundDone(noDrew, U1)).toBe(true);
  });
});

describe('dependency play: states that read exactly as today', () => {
  it('is off without the version, whatever the steps say', () => {
    const state = { rounds: CHAIN_ROUNDS, curRound: U1, gamemodeConfig: {}, waterfallSteps: [] };
    expect(usesDependencyPlay(state)).toBe(false);
    expect(roundsInPlay(state)).toEqual([U1, L1]);
    expect(isRoundReached(state, L1)).toBe(true);
    expect(isRoundReached(state, U2)).toBe(false);
    expect(nextColumnStart(state)).toBe(U2);
  });

  it('is off without a waterfall round at curRound (the pooling rounds, or a state with no steps field)', () => {
    const pooling = withDependencyPlay({ rounds: CHAIN_ROUNDS, curRound: 0, gamemodeConfig: {} });
    expect(usesDependencyPlay(pooling)).toBe(false);
    expect(roundsInPlay(pooling)).toEqual([0]);
    expect(isRoundDone(pooling, 0)).toBe(false);
  });

  it('is off in a tournament that is not a waterfall, even with the version set', () => {
    const state = withDependencyPlay({ rounds: PLAIN, curRound: 3, gamemodeConfig: {} });
    expect(usesDependencyPlay(state)).toBe(false);
    PLAIN.forEach((_, index) => {
      expect(isCurrentRound(state, index)).toBe(index === 3);
      expect(isRoundReached(state, index)).toBe(index <= 3);
      expect(isRoundDone(state, index)).toBe(index < 3);
    });
    expect(undrawnRounds(state)).toEqual([4, 5, 6, 7]);
  });

  it('lists the rounds after the column in play as undrawn outside dependency play', () => {
    expect(undrawnRounds(stateAt(COLUMNED, 2))).toEqual([4, 5, 6, 7]);
    expect(roundsInPlay(stateAt(COLUMNED, 4))).toEqual([4, 5, 6]);
  });
});
