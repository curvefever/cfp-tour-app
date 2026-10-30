import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { bestOfGameCount, roomMatch } from '../match-format';
import { isFinalComplete } from '../rankings';
import { createTournamentRuntime } from '../runtime';
import { removeRosterUnit } from '../mutations';
import { applyStageMatchEdit, stageMatchScope } from '../stage-match-edit';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { PersistedSetup, TournamentState } from '../types';
import { scoreCurrentRound } from './play-through';

function generated(count: number, setup: Partial<PersistedSetup>): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({ poolingPhase: 'none', gameFormat: 'individual-1v1', ...setup }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
  return { ...result.state, started: true };
}

function playUntil(state: TournamentState, reached: (round: TournamentState['rounds'][number]) => boolean) {
  let current = state;
  while (!reached(current.rounds[current.curRound])) {
    const advanced = advanceTournamentRound(scoreCurrentRound(current, 0));
    if (advanced.status !== 'advanced') throw new Error(`stopped at round ${current.curRound}`);
    current = advanced.state;
  }
  return current;
}

const inSemis = (setup: Partial<PersistedSetup> = {}) =>
  playUntil(generated(37, { scheduleLogic: 'single-elimination', ...setup }), (round) => round.isSemis);

function inFinal(setup: Partial<PersistedSetup> = {}): TournamentState {
  const semis = inSemis(setup);
  const advanced = advanceTournamentRound(scoreCurrentRound(semis, 0));
  if (advanced.status !== 'advanced') throw new Error('could not reach the Final');
  return advanced.state;
}

function finalScores(state: TournamentState, games: Record<string, number>): TournamentState {
  const finalists = state.assignments[state.curRound].map((entry) => entry.name);
  const typed = Object.fromEntries(
    Object.entries(games).map(([key, score]) => {
      const [game, seat] = key.split('/');
      return [`game${game}-${finalists[Number(seat)]}`, score];
    }),
  );
  return { ...state, finalScores: { ...state.finalScores, ...typed } };
}

function edit(
  state: TournamentState,
  input: Parameters<typeof applyStageMatchEdit>[1],
  rounds?: Parameters<typeof applyStageMatchEdit>[2],
): TournamentState {
  const result = applyStageMatchEdit(state, input, rounds);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function refusalOf(result: ReturnType<typeof applyStageMatchEdit>): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

function refusal(state: TournamentState, input: Parameters<typeof applyStageMatchEdit>[1]): string {
  return refusalOf(applyStageMatchEdit(state, input));
}

describe('stageMatchScope', () => {
  it('lists the stages of single elimination, prefilled from the config, and every round not finished', () => {
    const scope = stageMatchScope(generated(37, { scheduleLogic: 'single-elimination' }));
    if (scope.kind !== 'stages') throw new Error('expected stages');
    expect(scope.stages).toEqual([
      { stage: 'pooling', label: 'Pooling rounds', games: 1, locked: false },
      { stage: 'bracket', label: 'Elimination rounds', games: 1, locked: false },
      { stage: 'semis', label: 'Semis', games: 1, locked: false },
      { stage: 'finals', label: 'Final', games: 3, locked: false },
    ]);
    expect(scope.rounds.map((entry) => entry.name).slice(0, 3)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(scope.rounds.at(-1)).toMatchObject({ name: 'Final', stage: 'finals' });
    expect(scope.rounds.every((entry) => entry.override === undefined)).toBe(true);
  });

  it('shows a Best of N and the games the config keeps, and the override a round has', () => {
    const scope = stageMatchScope(
      generated(37, {
        scheduleLogic: 'single-elimination',
        finalsGames: '4',
        finalsBestOf: '3',
        matchOverrides: 'Round 3: GAMES 2',
      }),
    );
    if (scope.kind !== 'stages') throw new Error('expected stages');
    expect(scope.stages.at(-1)).toMatchObject({ stage: 'finals', games: 4, bestOf: 3 });
    expect(scope.rounds.find((entry) => entry.name === 'Round 3')?.override).toEqual({ games: 2 });
  });

  it('locks the Semis once the Final is reached, and no longer lists its round', () => {
    const scope = stageMatchScope(inFinal());
    if (scope.kind !== 'stages') throw new Error('expected stages');
    expect(scope.stages.find((entry) => entry.stage === 'semis')?.locked).toBe(true);
    expect(scope.stages.find((entry) => entry.stage === 'finals')?.locked).toBe(false);
    expect(scope.rounds.map((entry) => entry.name)).toEqual(['Final']);
  });

  it('covers the ladder of Kings Valley, the losers rounds of a double elimination and the pooling of a Custom bracket', () => {
    const stagesOf = (state: TournamentState) => {
      const scope = stageMatchScope(state);
      return scope.kind === 'stages' ? scope.stages.map((entry) => entry.stage) : scope.kind;
    };
    expect(stagesOf(generated(24, { scheduleLogic: 'kings-valley', gameFormat: 'ffa-individual' }))).toEqual([
      'pooling',
      'bracket',
      'finals',
    ]);
    expect(
      stagesOf(
        generated(37, { scheduleLogic: 'double-elimination-shared-final', gameFormat: 'ffa-individual' }),
      ),
    ).toEqual(['pooling', 'bracket', 'losers', 'finals']);
    expect(stagesOf(generated(16, { scheduleLogic: 'double-elimination' }))).toEqual([
      'pooling',
      'bracket',
      'losers',
    ]);
  });

  it('keeps the race Grand Final out', () => {
    const scope = stageMatchScope(generated(16, { scheduleLogic: 'double-elimination' }));
    if (scope.kind !== 'stages') throw new Error('expected stages');
    expect(scope.rounds.some((entry) => entry.name === 'Grand Final')).toBe(false);
  });
});

describe('changing the Final', () => {
  it('reads three summed games as a Best of 3: complete at 2-0, and the snapshot follows', () => {
    const state = finalScores(inFinal(), { '1/0': 20, '1/1': 10, '2/0': 20, '2/1': 10 });
    expect(isFinalComplete(state)).toBe(false);
    const next = edit(state, { finals: { games: 3, bestOf: 3 } });
    expect(next.rounds[next.curRound]).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(isFinalComplete(next)).toBe(true);
    expect(next.gamemodeConfig).toMatchObject({ finalsGames: 3, finalsBestOf: 3 });
    expect(next.settings).toMatchObject({ finalsGames: '3', finalsBestOf: '3' });
  });

  it('goes back to summed games, which clears the Best of N everywhere', () => {
    const best = edit(inFinal(), { finals: { games: 3, bestOf: 3 } });
    const back = edit(best, { finals: { games: 2 } });
    const final = back.rounds[back.curRound];
    expect(final.numGames).toBe(2);
    expect(final).not.toHaveProperty('bestOf');
    expect(back.gamemodeConfig).toMatchObject({ finalsGames: 2 });
    expect(back.gamemodeConfig).not.toHaveProperty('finalsBestOf');
    expect(back.settings).toMatchObject({ finalsGames: '2', finalsBestOf: '' });
  });

  it('refuses a Best of 3 Final cut to 2 games with game 3 typed', () => {
    const state = finalScores(inFinal({ finalsBestOf: '3' }), {
      '1/0': 20,
      '1/1': 10,
      '2/0': 10,
      '2/1': 20,
      '3/0': 5,
      '3/1': 1,
    });
    expect(refusal(state, { finals: { games: 2 } })).toBe(
      'Can\'t save: "Final" already has scores for game 3, so it can\'t be played over 2 games.',
    );
  });

  it('refuses a Best of N for a Final with anonymous games', () => {
    const state = inFinal();
    const marked = {
      ...state,
      rounds: state.rounds.map((round, index) =>
        index === state.curRound ? { ...round, anonymousGames: [1] } : round,
      ),
    };
    expect(refusal(marked, { finals: { games: 3, bestOf: 3 } })).toContain('anonymous games');
  });

  it('changes a Final that has not been reached yet', () => {
    const next = edit(generated(37, { scheduleLogic: 'single-elimination' }), {
      finals: { games: 3, bestOf: 5 },
    });
    expect(next.rounds.find((round) => round.isFinal)).toMatchObject({ bestOf: 5, numGames: 5 });
    expect(next.gamemodeConfig).toMatchObject({ finalsBestOf: 5 });
  });
});

describe('changing the Semis', () => {
  const typed = (state: TournamentState) => ({
    ...state,
    scores: { ...state.scores, [`r${state.curRound}-rm1-p0`]: 30, [`r${state.curRound}-rm1-p1`]: 10 },
  });

  it('moves a one-game Semis to Best of 3 with scores in: the typed scores become game 1', () => {
    const state = typed(inSemis());
    const round = state.curRound;
    const next = edit(state, { semis: { games: 1, bestOf: 3 } });
    expect(next.rounds[round]).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(next.scores[`r${round}-rm1-p0-g1`]).toBe(30);
    expect(next.scores[`r${round}-rm1-p0`]).toBeUndefined();
    expect(roomMatch(next, round, 1)).toMatchObject({ countedGames: 1, complete: false });
    expect(next.gamemodeConfig).toMatchObject({ semisBestOf: 3, semisGames: 1 });
    expect(next.settings).toMatchObject({ semisBestOf: '3' });
  });

  it('moves it back to one game while only game 1 is typed', () => {
    const best = edit(typed(inSemis()), { semis: { games: 1, bestOf: 3 } });
    const back = edit(best, { semis: { games: 1 } });
    expect(back.scores[`r${back.curRound}-rm1-p0`]).toBe(30);
    expect(back.rounds[back.curRound]).not.toHaveProperty('bestOf');
    expect(back.settings).toMatchObject({ semisBestOf: '' });
  });

  it('refuses a Semis that is finished', () => {
    const state = inFinal();
    expect(refusal(state, { semis: { games: 1, bestOf: 3 } })).toBe(
      'Can\'t save: "Semis" is finished, so its match format can\'t change.',
    );
    expect(applyStageMatchEdit(state, { semis: { games: 1 }, finals: { games: 2 } }).ok).toBe(true);
  });

  it('takes a Best of N Semis where a room holds more than two units', () => {
    const state = playUntil(
      generated(37, { scheduleLogic: 'single-elimination', gameFormat: 'ffa-individual' }),
      (round) => round.isSemis,
    );
    const next = edit(state, { semis: { games: 1, bestOf: 3 } });
    const semis = next.rounds[next.curRound];
    expect(semis).toMatchObject({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...semis.rooms)) });
  });

  it('changes the Semis and the Final in one save', () => {
    const next = edit(generated(37, { scheduleLogic: 'single-elimination' }), {
      semis: { games: 1, bestOf: 3 },
      finals: { games: 3, bestOf: 3 },
    });
    expect(next.rounds.find((round) => round.isSemis)).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(next.rounds.find((round) => round.isFinal)).toMatchObject({ bestOf: 3, numGames: 3 });
  });
});

describe('the Kings Valley Final', () => {
  it('takes the new format, and the config keeps it for a re-fit', () => {
    const state = generated(24, { scheduleLogic: 'kings-valley', gameFormat: 'ffa-individual' });
    const next = edit(state, { finals: { games: 3, bestOf: 3 } });
    const final = next.rounds.find((round) => round.isFinal);
    expect(final).toMatchObject({ bestOf: 3 });
    expect(final?.numGames).toBe(final ? final.players + 1 : 0);
    expect(next.gamemodeConfig).toMatchObject({ finalsBestOf: 3 });
  });
});

describe('the stages and rounds before the Semis, 1v1 at 37', () => {
  /** The first elimination round (Round 3, after two warm-ups) in play, one score typed in game 1 of its first room. */
  const inRound3 = () => {
    const state = playUntil(
      generated(37, { scheduleLogic: 'single-elimination' }),
      (round) => !round.isNoElim,
    );
    return { ...state, scores: { ...state.scores, [`r${state.curRound}-rm1-p0`]: 30 } };
  };
  const roundOf = (state: TournamentState, number: number) =>
    state.rounds.find((round) => round.roundNum === number);

  it('Elimination rounds 1 game to Best of 3 with Round 3 in play and a score in: the score becomes game 1, the later rounds follow, the Semis keep theirs', () => {
    const state = inRound3();
    const round = state.curRound;
    expect(state.rounds[round].roundNum).toBe(3);
    const next = edit(state, { bracket: { games: 1, bestOf: 3 } });
    expect(next.scores[`r${round}-rm1-p0-g1`]).toBe(30);
    expect(next.scores[`r${round}-rm1-p0`]).toBeUndefined();
    for (const number of [3, 4, 5]) {
      expect(roundOf(next, number)).toMatchObject({ bestOf: 3, numGames: 3 });
    }
    expect(next.rounds.find((entry) => entry.isSemis)).not.toHaveProperty('bestOf');
    expect(next.rounds.slice(0, round).every((entry) => entry.bestOf === undefined)).toBe(true);
    expect(next.gamemodeConfig).toMatchObject({ bracketBestOf: 3 });
    expect(next.settings).toMatchObject({ bracketBestOf: '3', bracketGames: '1' });
  });

  it('goes back to one game with only game 1 typed, and clears the Best of N key', () => {
    const best = edit(inRound3(), { bracket: { games: 1, bestOf: 3 } });
    const back = edit(best, { bracket: { games: 1 } });
    expect(back.scores[`r${back.curRound}-rm1-p0`]).toBe(30);
    expect(roundOf(back, 4)).not.toHaveProperty('bestOf');
    expect(back.gamemodeConfig).not.toHaveProperty('bracketBestOf');
    expect(back.gamemodeConfig).not.toHaveProperty('bracketGames');
    expect(back.settings).toMatchObject({ bracketBestOf: '', bracketGames: '1' });
  });

  it('a round row Best of 3 to 2 games is refused with game 3 typed, and changes nothing', () => {
    const best = edit(inRound3(), { bracket: { games: 1, bestOf: 3 } });
    const typed = { ...best, scores: { ...best.scores, [`r${best.curRound}-rm1-p0-g3`]: 5 } };
    const result = applyStageMatchEdit(typed, {}, { 'Round 3': { games: 2 } });
    expect(result).toEqual({
      ok: false,
      error: 'Can\'t save: "Round 3" already has scores for game 3, so it can\'t be played over 2 games.',
    });
  });

  it('a stage change that one round refuses writes nothing', () => {
    const best = edit(inRound3(), { bracket: { games: 1, bestOf: 3 } });
    const typed = { ...best, scores: { ...best.scores, [`r${best.curRound}-rm1-p0-g3`]: 5 } };
    const result = applyStageMatchEdit(typed, { bracket: { games: 2 } });
    expect(result.ok).toBe(false);
    expect(typed.gamemodeConfig).toMatchObject({ bracketBestOf: 3 });
    expect(result.ok ? null : result.error).toContain('game 3');
  });

  it('never changes a finished round: the warm-ups stay as they were, and their stage is locked', () => {
    const state = inRound3();
    const scope = stageMatchScope(state);
    if (scope.kind !== 'stages') throw new Error('expected stages');
    expect(scope.stages.find((entry) => entry.stage === 'pooling')?.locked).toBe(true);
    expect(scope.rounds.map((entry) => entry.name)).not.toContain('Round 1');
    expect(refusal(state, { pooling: { games: 1, bestOf: 3 } })).toBe(
      'Can\'t save: "Pooling rounds" is finished, so its match format can\'t change.',
    );
    expect(refusalOf(applyStageMatchEdit(state, {}, { 'Round 1': { games: 1, bestOf: 3 } }))).toContain(
      '"Round 1" is finished',
    );
    const next = edit(state, { bracket: { games: 1, bestOf: 3 } });
    expect(next.rounds.slice(0, 2)).toEqual(state.rounds.slice(0, 2));
  });

  it('a round row writes its override to the rounds, the config and the snapshot, and clearing it takes it out', () => {
    const state = generated(37, { scheduleLogic: 'single-elimination', bracketBestOf: '3' });
    const next = applyStageMatchEdit(state, {}, { 'Round 4': { games: 2 }, Final: { games: 1, bestOf: 5 } });
    if (!next.ok) throw new Error(next.error);
    expect(roundOf(next.state, 4)).toMatchObject({ numGames: 2 });
    expect(roundOf(next.state, 4)).not.toHaveProperty('bestOf');
    expect(next.state.rounds.find((entry) => entry.isFinal)).toMatchObject({ bestOf: 5, numGames: 5 });
    expect(next.state.gamemodeConfig.matchOverrides).toEqual({ 'Round 4': 'GAMES 2', Final: 'BO5' });
    expect(next.state.settings?.matchOverrides).toBe('Round 4: GAMES 2\nFinal: BO5');
    const cleared = edit(next.state, {}, { 'Round 4': null, Final: null });
    expect(roundOf(cleared, 4)).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(cleared.rounds.find((entry) => entry.isFinal)).toMatchObject({ numGames: 3 });
    expect(cleared.gamemodeConfig).not.toHaveProperty('matchOverrides');
    expect(cleared.settings?.matchOverrides).toBe('');
  });

  it('a stage change leaves a round with an override as it is', () => {
    const state = generated(37, { scheduleLogic: 'single-elimination', matchOverrides: 'Round 4: GAMES 2' });
    const next = edit(state, { bracket: { games: 1, bestOf: 3 } });
    expect(roundOf(next, 4)).toMatchObject({ numGames: 2 });
    expect(roundOf(next, 4)).not.toHaveProperty('bestOf');
    expect(roundOf(next, 5)).toMatchObject({ bestOf: 3, numGames: 3 });
  });

  it('refuses a round the schedule does not have', () => {
    const state = generated(37, { scheduleLogic: 'single-elimination' });
    expect(refusalOf(applyStageMatchEdit(state, {}, { 'Round 99': { games: 2 } }))).toBe(
      'Can\'t save: the schedule has no round "Round 99".',
    );
  });
});

describe('a Kings Valley ladder changed live', () => {
  it('keeps the new format on the tail the next advance re-plans', () => {
    const state = generated(24, { scheduleLogic: 'kings-valley', gameFormat: 'ffa-individual' });
    const changed = edit(state, { bracket: { games: 1, bestOf: 3 } });
    const victim = changed.assignments[changed.curRound].find((entry) => entry.room !== null)?.name as string;
    const advanced = advanceTournamentRound(scoreCurrentRound(removeRosterUnit(changed, victim), 0));
    if (advanced.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(advanced)}`);
    const ladder = advanced.state.rounds
      .slice(advanced.state.curRound)
      .filter((round) => round.isKingsValley);
    expect(ladder.length).toBeGreaterThan(0);
    for (const round of ladder) {
      expect(round).toMatchObject({ bestOf: 3, numGames: bestOfGameCount(3, Math.max(...round.rooms)) });
    }
  });

  it('keeps a round override of the Final on the re-planned tail (the config holds it)', () => {
    const state = generated(24, { scheduleLogic: 'kings-valley', gameFormat: 'ffa-individual' });
    const changed = edit(state, {}, { Final: { games: 1, bestOf: 5 } });
    expect(changed.gamemodeConfig.matchOverrides).toEqual({ Final: 'BO5' });
    const victim = changed.assignments[changed.curRound].find((entry) => entry.room !== null)?.name as string;
    const advanced = advanceTournamentRound(scoreCurrentRound(removeRosterUnit(changed, victim), 0));
    if (advanced.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(advanced)}`);
    const final = advanced.state.rounds.find((round) => round.isFinal);
    expect(final).toMatchObject({ bestOf: 5, numGames: bestOfGameCount(5, final?.players ?? 0) });
  });
});
