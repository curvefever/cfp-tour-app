import { describe, expect, it } from 'vitest';
import { groupSizesOf } from '../group-exit';
import { advanceTournamentRound } from '../transitions';
import type { ScheduleLogicKey, TournamentState } from '../types';
import { expectEveryUnitRankedOnce } from './dependency-play-fixtures';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';

/**
 * Everyone may go on, after any pooling phase and in any bracket style: the pooling phase then only decides who starts
 * where. A pooling phase never refuses it. Each case is generated with everyone going on and played to the Final with the
 * real transitions, every unit once in Rankings; a bracket style that cannot take that many for its own reasons (a room
 * size, a Kings Valley limit) refuses the fewer-by-one case the same way, so the refusal is not about everyone.
 */

type Setup = SweepConfig['setup'];

const LOGICS: ScheduleLogicKey[] = [
  'single-elimination',
  'double-elimination',
  'double-elimination-shared-final',
  'kings-valley',
  'upper-lower',
];

const label = (parts: Array<string | number>) => parts.join(' / ');

/** The state generated for `setup`, or null when generation refuses it. */
function generatedFor(count: number, setup: Setup): TournamentState | null {
  return buildState({ label: '', count, setup, teams: false });
}

/** Played to the Final (or the Grand Final) with every unit scored distinctly. */
function playToTheFinal(start: TournamentState): TournamentState {
  let state = start;
  for (let guard = 0; guard < 40; guard += 1) {
    const round = state.rounds[state.curRound];
    if (round.isFinal || round.bracket === 'grand-final') return state;
    const result = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (result.status === 'blocked') throw new Error(`blocked in round ${round.roundNum}: ${result.message}`);
    if (result.status === 'noop') return state;
    state = result.state;
  }
  throw new Error('did not reach the Final within 40 rounds');
}

/** Everyone going on plays; or generation refuses, and then refuses one fewer for the same reason. */
function expectEveryoneGoesOn(count: number, everyone: Setup, almostEveryone: Setup | null): void {
  const state = generatedFor(count, everyone);
  if (state === null) {
    // A bracket style that takes fewer than everyone on its own terms; the plain refusal is not about everyone.
    if (almostEveryone) expect(generatedFor(count, almostEveryone), 'one fewer').toBeNull();
    return;
  }
  const final = playToTheFinal(state);
  expectEveryUnitRankedOnce(final, count);
}

describe('a qualification table sends everyone on', () => {
  const FORMATS = [
    ['ffa-individual', [12, 13, 17, 24, 29, 31]],
    ['individual-1v1', [7, 9, 10, 13]],
  ] as const;
  for (const [gameFormat, counts] of FORMATS) {
    for (const scheduleLogic of LOGICS) {
      for (const count of counts) {
        it(label([gameFormat, 'qualification table', scheduleLogic, count]), () => {
          const base = {
            gameFormat,
            scheduleLogic,
            poolingPhase: 'qual-table',
            oddCountStrategy: 'bye',
          } as const;
          expectEveryoneGoesOn(
            count,
            { ...base, qualAdv: String(count) },
            { ...base, qualAdv: String(count - 1) },
          );
        });
      }
    }
  }
});

describe('a Swiss sends everyone on', () => {
  for (const scheduleLogic of LOGICS) {
    for (const count of [7, 9, 10, 13]) {
      it(label(['1v1 Swiss', scheduleLogic, count]), () => {
        const base = {
          gameFormat: 'individual-1v1',
          scheduleLogic,
          poolingPhase: 'swiss',
          oddCountStrategy: 'bye',
        } as const;
        expectEveryoneGoesOn(
          count,
          { ...base, qualAdv: String(count) },
          { ...base, qualAdv: String(count - 1) },
        );
      });
    }
  }
});

describe('a group stage sends everyone on', () => {
  const base = {
    gameFormat: 'individual-1v1',
    poolingPhase: 'group-stage',
    groupSize: '4',
    oddCountStrategy: 'bye',
  } as const;
  for (const scheduleLogic of LOGICS) {
    for (const count of [7, 9, 10, 13, 17]) {
      for (const groupExit of ['fair-cut', 'even-split'] as const) {
        it(label(['groups', groupExit, scheduleLogic, count]), () => {
          const setup = { ...base, scheduleLogic, groupExit };
          expectEveryoneGoesOn(
            count,
            { ...setup, qualAdv: String(count) },
            { ...setup, qualAdv: String(count - 1) },
          );
        });
      }
      it(label(['groups', 'per group', scheduleLogic, count]), () => {
        const smallest = Math.min(...groupSizesOf(count, 4));
        const setup = { ...base, scheduleLogic };
        expectEveryoneGoesOn(
          count,
          { ...setup, qualifiersPerGroup: String(smallest) },
          // An upper and lower bracket takes only the numbers it has rooms for: a smaller per-group exit can generate.
          smallest > 1 && scheduleLogic !== 'upper-lower'
            ? { ...setup, qualifiersPerGroup: String(smallest - 1) }
            : null,
        );
      });
    }
  }
});
