import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { roomMatch } from '../match-format';
import { isFinalComplete } from '../rankings';
import { createTournamentRuntime } from '../runtime';
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

function edit(state: TournamentState, input: Parameters<typeof applyStageMatchEdit>[1]): TournamentState {
  const result = applyStageMatchEdit(state, input);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function refusal(state: TournamentState, input: Parameters<typeof applyStageMatchEdit>[1]): string {
  const result = applyStageMatchEdit(state, input);
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

describe('stageMatchScope', () => {
  it('lists the Semis and the Final of single elimination, prefilled from the rounds', () => {
    const scope = stageMatchScope(generated(37, { scheduleLogic: 'single-elimination' }));
    expect(scope).toMatchObject({
      kind: 'stages',
      stages: [
        { stage: 'semis', games: 1, locked: false, bestOfOffered: true },
        { stage: 'finals', games: 3, locked: false, bestOfOffered: true },
      ],
    });
  });

  it('shows a Best of N from the round and the games the settings keep', () => {
    const scope = stageMatchScope(
      generated(37, { scheduleLogic: 'single-elimination', finalsGames: '4', finalsBestOf: '3' }),
    );
    expect(scope).toMatchObject({ stages: [{}, { stage: 'finals', games: 4, bestOf: 3 }] });
  });

  it('locks the Semis once the Final is reached, and offers no Best of N for the Semis in a multi-unit format', () => {
    const scope = stageMatchScope(inFinal());
    expect(scope).toMatchObject({
      stages: [
        { stage: 'semis', locked: true },
        { stage: 'finals', locked: false },
      ],
    });
    const ffa = stageMatchScope(
      generated(37, { scheduleLogic: 'single-elimination', gameFormat: 'ffa-individual' }),
    );
    expect(ffa).toMatchObject({ stages: [{ bestOfOffered: false }, { bestOfOffered: true }] });
  });

  it('covers only the Final in Kings Valley and shared-Final double elimination, and nothing in the race or the Custom bracket', () => {
    const kings = stageMatchScope(
      generated(24, { scheduleLogic: 'kings-valley', gameFormat: 'ffa-individual' }),
    );
    expect(kings).toMatchObject({ stages: [{ stage: 'finals' }] });
    const shared = stageMatchScope(
      generated(37, { scheduleLogic: 'double-elimination-shared-final', gameFormat: 'ffa-individual' }),
    );
    expect(shared).toMatchObject({ stages: [{ stage: 'finals' }] });
    expect(stageMatchScope(generated(16, { scheduleLogic: 'double-elimination' })).kind).toBe('none');
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

  it('refuses a Best of N Semis where a room holds more than two units, and changes nothing', () => {
    const state = playUntil(
      generated(37, { scheduleLogic: 'single-elimination', gameFormat: 'ffa-individual' }),
      (round) => round.isSemis,
    );
    expect(refusal(state, { semis: { games: 1, bestOf: 3 }, finals: { games: 3, bestOf: 3 } })).toContain(
      'only head to head',
    );
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
