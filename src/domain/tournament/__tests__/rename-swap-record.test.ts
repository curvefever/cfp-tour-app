import { describe, expect, it } from 'vitest';
import { computeGroupStandings } from '../advancement';
import { answerAbsence } from '../absences';
import { groupSeats } from '../group-standings';
import { isLikelyAbsent } from '../likely-absentees';
import { renameIndividual, swapIndividual } from '../mutations';
import { deriveRoomSize, getGameFormat } from '../formats';
import { roundsBeforeBracket } from '../pooling-rounds';
import { roundsInPlay } from '../round-columns';
import { createDefaultSetup } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import { upperLowerEntry, upperLowerGraphText } from '../upper-lower';
import type { TournamentState } from '../types';
import { goBack } from '../waterfall-steps';
import { pressed, resolveEveryTie, scoreRound } from './dependency-play-fixtures';
import { buildState, scoreCurrentRound } from './play-through';
import { generated, oneRoomState } from './test-fixtures';

/**
 * A swap records "A was replaced by B" in `withdrawnUnits[].replacedBy`, and the rounds A played still carry A's
 * name: four readers follow the record to B. A rename of B has to reach the record, or they lose the link.
 */

describe('a rename follows the swap record', () => {
  it('moves the replacement name in every withdrawal record, and leaves the withdrawn unit as it was', () => {
    const swapped = swapIndividual({ ...oneRoomState(), reserves: ['Zed'] }, 'Ann', 'Zed');
    const renamed = renameIndividual(swapped, 'Zed', 'Zed2');
    expect(renamed.withdrawnUnits.map((unit) => [unit.name, unit.replacedBy])).toEqual([['Ann', 'Zed2']]);
  });

  it('group stage: the renamed substitute keeps the counted match of the seat it took over', () => {
    const generated = buildState({
      label: 'group of 8',
      count: 8,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        qualAdv: '4',
      },
    }) as TournamentState;
    const advanced = advanceTournamentRound(scoreCurrentRound(generated, 0));
    if (advanced.status !== 'advanced') throw new Error(`expected an advance, got ${advanced.status}`);
    const [first] = advanced.state.assignments[0].filter((entry) => entry.room === 1);
    const swapped = swapIndividual({ ...advanced.state, reserves: ['Sub'] }, first.name, 'Sub');
    expect(swapped).not.toBe(advanced.state);
    const matchesOf = (state: TournamentState, name: string) =>
      Object.values(computeGroupStandings(state))
        .flat()
        .find((entry) => entry.name === name)?.matches;
    expect(matchesOf(swapped, 'Sub')).toBe(1);

    const renamed = renameIndividual(swapped, 'Sub', 'Sub2');
    expect(groupSeats(renamed).holderOf(first.name)).toBe('Sub2');
    expect(matchesOf(renamed, 'Sub2')).toBe(1);
  });

  it('likely absentees: the renamed replacement still does not inherit the seat’s absence', () => {
    const base = oneRoomState({
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 50, 'r1-rm1-p0': 0, 'r1-rm1-p1': 50 },
    });
    const state = { ...base, gamemodeConfig: { ...base.gamemodeConfig, absenceVersion: 3 as const } };
    const absent = answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    const swapped = swapIndividual({ ...absent, reserves: ['Zed'] }, 'Ann', 'Zed');
    expect(isLikelyAbsent(swapped, 'Zed', 1)).toBe(false);
    const renamed = renameIndividual(swapped, 'Zed', 'Zed2');
    expect(isLikelyAbsent(renamed, 'Zed2', 1)).toBe(false);
  });
});

describe('Previous and Next Round after a rename of a replacement', () => {
  /** FFA 31 with a qualification table and the built-in upper and lower bracket, in dependency play, two bracket presses made. */
  function upperLowerAfterTwoPresses(): TournamentState {
    const setup = createDefaultSetup({
      scheduleLogic: 'waterfall-bracket',
      gameFormat: 'ffa-individual',
      poolingPhase: 'qual-table',
    });
    const roomSize = deriveRoomSize(getGameFormat(setup.gameFormat) as never);
    const entry = upperLowerEntry(31, null, roomSize);
    if (!entry.ok) throw new Error(entry.message);
    const graph = upperLowerGraphText(entry.entry, roomSize, roundsBeforeBracket(setup, 31) + 1, 'qual');
    let state: TournamentState = {
      ...generated(31, {
        gameFormat: 'ffa-individual',
        poolingPhase: 'qual-table',
        scheduleLogic: 'waterfall-bracket',
        waterfallGraph: graph,
      }),
      started: true,
    };
    for (let press = 0; press < 4; press += 1) {
      state = pressed(resolveEveryTie(scoreRound(state, state.curRound), state.curRound));
    }
    return state;
  }

  /** A unit the last press sent on that is seated in a round now in play: its name is in a recorded line-up. */
  function sentUnitStillPlaying(state: TournamentState): string {
    const sent = state.waterfallSteps[state.waterfallSteps.length - 1].sent;
    const inPlay = new Set(
      roundsInPlay(state).flatMap((round) => state.assignments[round].map((e) => e.name)),
    );
    const unit = state.assignments[sent[0]].find((entry) => entry.room !== null && inPlay.has(entry.name));
    if (!unit) throw new Error('no sent unit is still playing');
    return unit.name;
  }

  it('undo the last press the same way as without the rename, and draw the same line-up again', () => {
    const state = upperLowerAfterTwoPresses();
    const name = sentUnitStillPlaying(state);
    const swapped = swapIndividual({ ...state, reserves: ['Sub'] }, name, 'Sub');
    expect(swapped).not.toBe(state);
    const renamed = renameIndividual(swapped, 'Sub', 'Sub2');

    const backPlain = goBack(swapped);
    const backRenamed = goBack(renamed);
    expect(backPlain.waterfallSteps).toHaveLength(0);
    expect(backRenamed.curRound).toBe(backPlain.curRound);
    expect(backRenamed.waterfallSteps).toHaveLength(0);

    const again = pressed(
      resolveEveryTie(scoreRound(backRenamed, backRenamed.curRound), backRenamed.curRound),
    );
    const plainAgain = pressed(
      resolveEveryTie(scoreRound(backPlain, backPlain.curRound), backPlain.curRound),
    );
    const plain = (value: unknown) => JSON.stringify(value).replaceAll('Sub2', 'Sub');
    expect(plain(again.assignments)).toBe(plain(plainAgain.assignments));
    expect(again.curRound).toBe(plainAgain.curRound);
  });
});
