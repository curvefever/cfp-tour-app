import { describe, expect, it } from 'vitest';
import { bracketRoundLabels } from '../bracket';
import { generateTournament } from '../generation';
import type { GenerationForm } from '../generation-plan-types';
import { previewRuntime, previewSchedule, standInRosterState } from '../schedule-preview';
import { createDefaultSetup, createDefaultTournamentState, newTournamentSetup } from '../state-defaults';
import type { GameFormatKey, TournamentState } from '../types';
import { generatedState, rosterFor, TEAM_QUAL_GRAPH, testRuntime } from './test-fixtures';

const NOTHING_LOADED = createDefaultTournamentState();

const loaded = (gameFormat: GameFormatKey, count: number): TournamentState =>
  createDefaultTournamentState({ gameFormat, confirmedCount: count, players: rosterFor(gameFormat, count) });

const generatedPreview = (current: TournamentState, form: GenerationForm, count: number) => {
  const preview = previewSchedule(current, form, count, previewRuntime());
  if (preview.status !== 'generated') throw new Error(preview.message);
  return preview;
};

/** What the Setup shows of a schedule: each round's name, rooms and numbers. No names. */
const shapeOf = (state: TournamentState) => {
  const labels = bracketRoundLabels(state);
  return state.rounds.map((round, index) => ({
    label: labels[index].label,
    rooms: round.rooms,
    players: round.players,
    advTotal: round.advTotal,
    luckyCount: round.luckyCount,
    byeCount: round.byeCount,
  }));
};

const ONE_V_ONE = { gameFormat: 'individual-1v1', oddCountStrategy: 'bye' } as const;

const FORMS: Array<[string, GenerationForm]> = [
  ['FFA, qualification table and single elimination', newTournamentSetup()],
  ['FFA, qualification table and a layered bracket', { ...newTournamentSetup(), scheduleLogic: 'layered' }],
  [
    '1v1, Swiss and an upper and lower bracket',
    { ...newTournamentSetup(), ...ONE_V_ONE, poolingPhase: 'swiss', scheduleLogic: 'upper-lower' },
  ],
  [
    '1v1, group stage and single elimination',
    { ...newTournamentSetup(), ...ONE_V_ONE, poolingPhase: 'group-stage' },
  ],
  [
    '2v2v2v2, qualification table and a Custom bracket',
    {
      ...newTournamentSetup(),
      gameFormat: 'team-2v2v2v2',
      teamScoringRule: 'sum-members',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: TEAM_QUAL_GRAPH,
    },
  ],
];

describe.each(FORMS)('the preview of a typed count is what Generate builds: %s', (_name, form) => {
  it.each([31, 37, 43, 53])('at %i', (count) => {
    const preview = generatedPreview(NOTHING_LOADED, form, count);
    const real = generatedState(generateTournament(loaded(form.gameFormat, count), form, testRuntime()));
    expect(shapeOf(preview.state)).toEqual(shapeOf(real));
    expect(preview.state.cfg).toEqual(real.cfg);
  });
});

describe('previewSchedule: whose roster it runs on', () => {
  const form = newTournamentSetup();

  it('runs on the loaded roster for its own count', () => {
    const current = loaded('ffa-individual', 37);
    expect(generatedPreview(current, form, 37).state.players).toEqual(current.players);
  });

  it('runs on stand-ins for another count than the roster’s', () => {
    const preview = generatedPreview(loaded('ffa-individual', 37), form, 43);
    expect(preview.plan.unitCount).toBe(43);
    expect(preview.state.players).toEqual(standInRosterState('ffa-individual', 43).players);
  });

  it('runs on stand-ins with no roster loaded, in teams of the format’s size', () => {
    const preview = generatedPreview(NOTHING_LOADED, FORMS[4][1], 31);
    expect(preview.state.players).toHaveLength(31);
    expect(preview.state.players[0]).toMatchObject({
      teamName: 'Team 1',
      members: [{ name: 'Player 1-1' }, { name: 'Player 1-2' }],
    });
  });

  it('takes a missing confirmed count as no roster, as generation does', () => {
    const current = { ...loaded('ffa-individual', 37), confirmedCount: undefined as unknown as null };
    expect(generatedPreview(current, form, 37).state.players).toEqual(
      standInRosterState('ffa-individual', 37).players,
    );
  });

  it('writes nothing, and draws the same each time', () => {
    const current = loaded('ffa-individual', 37);
    const before = structuredClone(current);
    const first = generatedPreview(current, form, 37);
    expect(current).toEqual(before);
    expect(generatedPreview(current, form, 37).state).toEqual(first.state);
  });

  it('gives generation’s own refusal', () => {
    const real = generateTournament(loaded('ffa-individual', 11), form, testRuntime());
    expect(real.status).toBe('invalid');
    expect(previewSchedule(NOTHING_LOADED, form, 11, previewRuntime())).toEqual(real);
  });

  it('refuses as Generate does when the loaded roster is for another format', () => {
    const teams = createDefaultSetup({ gameFormat: 'team-2v2v2v2' });
    const preview = previewSchedule(loaded('ffa-individual', 37), teams, 37, previewRuntime());
    expect(preview).toMatchObject({
      status: 'invalid',
      message: expect.stringMatching(/roster was loaded for a different game format/),
    });
  });
});
