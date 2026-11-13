import { describe, expect, it } from 'vitest';
import { roundsInPlay } from '../round-columns';
import type { TournamentState } from '../types';
import { goBack } from '../waterfall-steps';
import { expectConsistent, removeChecked, renameChecked, swapChecked } from './consistency';
import { pressed, resolveEveryTie, scoreRound } from './dependency-play-fixtures';
import {
  buildQualWaterfall,
  playToQualificationExit,
  withDependencyPlay,
  withoutDependencyPlay,
} from './qual-waterfall';
import { generated } from './test-fixtures';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * A round sent on again (Previous, then Next Round) sends the units that hold its seats now: a unit removed after the
 * first press stays out, and one swapped out is replaced by its replacement, in the seat's slot.
 */

type Correction = (state: TournamentState, name: string) => TournamentState;

const removal: Correction = (state, name) => removeChecked(state, name);
const swap: Correction = (state, name) => swapChecked({ ...state, reserves: ['Sub'] }, name, 'Sub');
const swapThenRename: Correction = (state, name) => renameChecked(swap(state, name), 'Sub', 'Sub2');

/** The units waiting in pools, by round; a round with nobody waiting is left out. */
const waiting = (state: TournamentState) =>
  Object.fromEntries(Object.entries(state.pendingBracketSeeds).filter(([, seeds]) => seeds.length > 0));

const firstPooled = (state: TournamentState): string => {
  const seed = Object.values(state.pendingBracketSeeds).flat()[0];
  if (!seed) throw new Error('no unit waits in a pool');
  return seed.name;
};

/** Scores the first round in play and presses Next Round: it is sent on, its units wait in pools. */
function sendFirstRound(state: TournamentState): { sent: TournamentState; roundIndex: number } {
  const roundIndex = roundsInPlay(state).find((index) => !state.rounds[index].isFinal) as number;
  return { sent: pressed(resolveEveryTie(scoreRound(state, roundIndex), roundIndex)), roundIndex };
}

/** Sends the round, corrects, takes the press back, sends it again: the pools must be those right after the correction. */
function expectResendKeepsCorrection(entry: TournamentState, correct: Correction): void {
  const { sent } = sendFirstRound(entry);
  expectConsistent(sent);
  const corrected = correct(sent, firstPooled(sent));
  expectConsistent(corrected);
  const back = goBack(corrected);
  expect(waiting(back)).toEqual({});
  expectConsistent(back);
  const again = pressed(back);
  expectConsistent(again);
  expect(waiting(again)).toEqual(waiting(corrected));
}

/** An FFA tournament with a qualification table and the built-in upper and lower bracket, at its first bracket round. */
function atBracketEntry(count: number, qualAdv: number): TournamentState {
  let state: TournamentState = {
    ...generated(count, {
      gameFormat: 'ffa-individual',
      poolingPhase: 'qual-table',
      scheduleLogic: 'upper-lower' as never,
      qualAdv: String(qualAdv),
    }),
    started: true,
  };
  while (!state.rounds[state.curRound].isWaterfall) {
    state = pressed(resolveEveryTie(scoreRound(state, state.curRound), state.curRound));
  }
  return state;
}

describe('the live case: FFA 13, qualification table, upper and lower bracket, everyone enters', () => {
  const entry = atBracketEntry(13, 13);

  it('a unit removed while it waits does not come back when the round is sent again', () => {
    expectResendKeepsCorrection(entry, removal);
  });

  it('a unit swapped while it waits is replaced by its replacement in the slot, not brought back', () => {
    expectResendKeepsCorrection(entry, swap);
  });

  it('the replacement renamed afterwards keeps the slot', () => {
    expectResendKeepsCorrection(entry, swapThenRename);
  });
});

describe('awkward counts, removal of a waiting unit', () => {
  it.each([
    [16, 16],
    [31, 24],
    [37, 32],
  ])('FFA %i, %i enter the bracket', (count, qualAdv) => {
    expectResendKeepsCorrection(atBracketEntry(count, qualAdv), removal);
  });
});

describe('a hand-written Custom bracket in dependency play', () => {
  it('FFA 37, the upper and lower graph: a removed unit stays out and a swapped one is replaced', () => {
    const entry = withDependencyPlay(
      pressed(playToQualificationExit(buildQualWaterfall(37, UPPER_LOWER_GRAPH, {}, { columns: true }))),
    );
    expectResendKeepsCorrection(entry, removal);
    expectResendKeepsCorrection(entry, swap);
  });
});

describe('column play', () => {
  it('a removed unit waiting for a later column stays out through Previous and Next Round', () => {
    const entry = withoutDependencyPlay(atBracketEntry(13, 13));
    const column = roundsInPlay(entry);
    let scored = entry;
    for (const index of column) scored = resolveEveryTie(scoreRound(scored, index), index);
    const sent = pressed(scored);
    const name = firstPooled(sent);
    const removed = removeChecked(sent, name);
    expectConsistent(removed);
    const back = goBack(removed);
    const again = pressed(back);
    expectConsistent(again);
    expect(
      Object.values(again.pendingBracketSeeds)
        .flat()
        .map((seed) => seed.name),
    ).not.toContain(name);
  });
});

/** Qualification ranks 17-24 go to R2, which R1 feeds too: they wait in a pool while R1 is played. */
const QUAL_EXIT_WAITS_GRAPH = `
ROUNDS:
R1 = 2x8
R2 = 2x8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R2
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R2.A: 1-4->Final, 5-8->eliminated
R2.B: 1-4->Final, 5-8->eliminated
`;

describe('the Qual exit', () => {
  it('a unit removed while it waits in a round not drawn at the exit stays out through Previous and Next Round', () => {
    const exit = withDependencyPlay(
      pressed(
        playToQualificationExit(
          buildQualWaterfall(25, QUAL_EXIT_WAITS_GRAPH, { qualAdv: '25' }, { columns: true }),
        ),
      ),
    );
    const name = firstPooled(exit);
    const removed = removeChecked(exit, name);
    expectConsistent(removed);
    const again = pressed(goBack(removed));
    expectConsistent(again);
    expect(
      Object.values(again.pendingBracketSeeds)
        .flat()
        .map((seed) => seed.name),
    ).not.toContain(name);
  });
});
