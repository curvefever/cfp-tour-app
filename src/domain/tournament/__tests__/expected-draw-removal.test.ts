import { describe, expect, it } from 'vitest';
import { expectedRounds } from '../expected-draw';
import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { pressed, resolveEveryTie, scoreRound } from './dependency-play-fixtures';
import { spreadConfig, startSpread } from './spread-play';
import { rosterFor, startedState, testRuntime } from './test-fixtures';

/**
 * The Expected draw shown after a removal is accurate: a unit leaves a room (scored or not) and the next rounds
 * refit, and `expectedRounds` shows exactly what Next Round then draws, round by round and unit by unit. A removal
 * goes through `removeRosterUnit`, as the Rankings ✕ does after the start. Regression check of the production test
 * of 2026-11-10 (FFA 29 -> 28): the Expected changes after a removal because the draw does.
 */

const COUNTS = [29, 31, 37, 43, 53];

function upperLower(count: number): TournamentState {
  const form = createDefaultSetup({
    gameFormat: 'ffa-individual',
    scheduleLogic: 'upper-lower',
    poolingPhase: 'qual-table',
    qualAdv: '32',
  });
  return startedState(
    generateTournament(
      createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
      form,
      testRuntime(),
    ),
  );
}

const singleElimination = (count: number): TournamentState => startSpread(spreadConfig('ffa', count));

const FORMATS: Array<[string, (count: number) => TournamentState]> = [
  ['upper and lower bracket after a qualification table', upperLower],
  ['single elimination after a qualification table', singleElimination],
];

/** Whether the round is played before the bracket: a qualification or warm-up round, not a bracket round. */
const isPooling = (state: TournamentState, roundIndex: number): boolean => {
  const round = state.rounds[roundIndex];
  return !round.isWaterfall && (round.isQual || round.isNoElim);
};

/** The state at the start of each pooling round (drawn, nothing scored), walked with distinct scores and no tie left. */
function poolingStarts(start: TournamentState): TournamentState[] {
  const starts: TournamentState[] = [];
  let state = start;
  while (isPooling(state, state.curRound)) {
    starts.push(state);
    state = pressed(resolveEveryTie(scoreRound(state, state.curRound), state.curRound));
  }
  return starts;
}

/** A unit seated in the first, a middle and the last room of the round in play. */
function removalTargets(state: TournamentState): string[] {
  const seated = state.assignments[state.curRound].filter((entry) => entry.room !== null);
  const rooms = [...new Set(seated.map((entry) => entry.room as number))].sort((a, b) => a - b);
  const picks = [rooms[0], rooms[Math.floor(rooms.length / 2)], rooms[rooms.length - 1]];
  return [...new Set(picks)].map((room) => seated.find((entry) => entry.room === room)?.name as string);
}

/** The expected draw of the round in play, scored and with every tie settled, equals what Next Round draws. */
function expectExpectedToMatchNextRound(scored: TournamentState, label: string): number {
  const settled = resolveEveryTie(scored, scored.curRound);
  const expected = expectedRounds(settled);
  expect(expected, label).not.toBeNull();
  const next = pressed(settled);
  for (const [roundIndex, round] of expected ?? []) {
    expect(round.assignments, `${label} round ${roundIndex}`).toEqual(next.assignments[roundIndex]);
    expect(round.byes, `${label} round ${roundIndex} byes`).toEqual(next.byes[roundIndex] ?? []);
    expect(round.rooms, `${label} round ${roundIndex} rooms`).toEqual(next.rounds[roundIndex].rooms);
  }
  return expected?.size ?? 0;
}

describe('the Expected draw after a removal equals what Next Round draws', () => {
  describe.each(FORMATS)('%s', (_name, build) => {
    it.each(COUNTS)('%i players: a removal before the round is scored, and after', (count) => {
      const starts = poolingStarts(build(count));
      expect(starts.length).toBeGreaterThan(2);
      let compared = 0;
      for (const [round, start] of starts.entries()) {
        for (const target of removalTargets(start)) {
          const label = `${count} players, round ${round + 1}, ${target}`;
          const before = removeRosterUnit(start, target);
          compared += expectExpectedToMatchNextRound(
            scoreRound(before, before.curRound),
            `${label} removed before scoring`,
          );
          const scored = scoreRound(start, start.curRound);
          compared += expectExpectedToMatchNextRound(
            removeRosterUnit(scored, target),
            `${label} removed after scoring`,
          );
        }
      }
      expect(compared).toBeGreaterThan(starts.length * 2);
    });
  });
});
