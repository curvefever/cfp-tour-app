import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { nextColumnStart, roundsInPlay, usesDependencyPlay } from '../round-columns';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { atEntry, indexOf, onlyFinalInPlay, pressed, scoreRound } from './dependency-play-fixtures';
import { buildQualWaterfall, playToQualificationExit, playerNames } from './qual-waterfall';
import { fixedIdSource, startedState } from './test-fixtures';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';
import { pressNextRound } from './play-through';

/** A tournament is played by dependency play only when generation wrote its version: the older ones keep their columns. */

function generated(scheduleLogic: 'waterfall-bracket' | 'single-elimination'): TournamentState {
  return startedState(
    generateTournament(
      createDefaultTournamentState({ confirmedCount: 37, players: playerNames(37) }),
      createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic,
        poolingPhase: 'qual-table',
        qualAdv: scheduleLogic === 'waterfall-bracket' ? '99' : '24',
        ...(scheduleLogic === 'waterfall-bracket' ? { waterfallGraph: UPPER_LOWER_GRAPH } : {}),
      }),
      createTournamentRuntime({ ids: fixedIdSource() }),
    ),
  );
}

describe('a newly generated Custom bracket', () => {
  it('stores the version and plays by dependency play from the pooling exit to the Final', () => {
    const generatedState = generated('waterfall-bracket');
    expect(generatedState.gamemodeConfig.dependencyPlayVersion).toBe(1);
    expect(generatedState.waterfallSteps).toEqual([]);
    let current = pressNextRound(playToQualificationExit(generatedState));
    expect(usesDependencyPlay(current)).toBe(true);
    // Sending R4U alone draws SemiA at once: a column would have waited for R4L.
    const r4u = indexOf(current, 'R4U');
    current = pressed(scoreRound(current, r4u));
    expect(current.assignments[indexOf(current, 'SemiA')].length).toBeGreaterThan(0);
    expect(current.waterfallSteps).toHaveLength(1);
    for (let guard = 0; guard < 60 && !onlyFinalInPlay(current); guard += 1) {
      for (const index of roundsInPlay(current)) {
        if (!current.rounds[index].isFinal) current = scoreRound(current, index);
      }
      current = pressed(current);
    }
    expect(onlyFinalInPlay(current)).toBe(true);
  });

  it('writes the version for a tournament that is not a Custom bracket, with no effect on it', () => {
    const state = generated('single-elimination');
    expect(state.gamemodeConfig.dependencyPlayVersion).toBe(1);
    expect(usesDependencyPlay(state)).toBe(false);
  });
});

describe('a stored Custom bracket without the version', () => {
  const stored = buildQualWaterfall(37, UPPER_LOWER_GRAPH, {}, { columns: true });
  const entry = atEntry(37, UPPER_LOWER_GRAPH);

  it('has none', () => {
    expect(stored.gamemodeConfig.dependencyPlayVersion).toBeUndefined();
    expect(entry.gamemodeConfig.dependencyPlayVersion).toBeUndefined();
  });

  it('plays a column at a time from the pooling exit to the Final, with no step recorded', () => {
    let state = entry;
    let presses = 0;
    for (let guard = 0; guard < 20 && !state.rounds[state.curRound].isFinal; guard += 1) {
      const next = nextColumnStart(state);
      for (const index of roundsInPlay(state)) state = scoreRound(state, index);
      state = pressed(state);
      // The press sent the whole column on: curRound is the first round of the next column.
      expect(state.curRound).toBe(next);
      expect(usesDependencyPlay(state)).toBe(false);
      expect(state.waterfallSteps).toEqual([]);
      presses += 1;
    }
    expect(state.rounds[state.curRound].isFinal).toBe(true);
    expect(presses).toBe(4);
    expect(state.assignments[state.curRound].length).toBeGreaterThan(0);
  });
});
