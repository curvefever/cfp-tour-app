import { describe, expect, it } from 'vitest';
import { generateTournament } from '../../../domain/tournament/generation';
import type { GenerationForm } from '../../../domain/tournament/generation-plan-types';
import { previewRuntime, previewSchedule } from '../../../domain/tournament/schedule-preview';
import {
  createDefaultSetup,
  createDefaultTournamentState,
  newTournamentSetup,
} from '../../../domain/tournament/state-defaults';
import { TEAM_QUAL_GRAPH } from '../../../domain/tournament/__tests__/test-fixtures';
import { appValueOf, planDecisions, type AppValueField } from './plan-decisions';

const NOTHING_LOADED = createDefaultTournamentState();
const ffa = newTournamentSetup();
const oneVOne: GenerationForm = {
  ...newTournamentSetup(),
  gameFormat: 'individual-1v1',
  oddCountStrategy: 'bye',
  poolingPhase: 'swiss',
};
const shared: GenerationForm = { ...ffa, scheduleLogic: 'double-elimination-shared-final' };

const previewOf = (form: GenerationForm, count: number) => {
  const preview = previewSchedule(NOTHING_LOADED, form, count, previewRuntime());
  if (preview.status !== 'generated') throw new Error(preview.message);
  return preview;
};

/** Each line as "Label: text (source)". */
const linesOf = (form: GenerationForm, count: number) =>
  planDecisions(form, previewOf(form, count)).map(
    ({ label, text, source }) => `${label}: ${text} (${source})`,
  );

const labelsOf = (form: GenerationForm, count: number) =>
  planDecisions(form, previewOf(form, count)).map((line) => line.label);

const appValue = (field: AppValueField, form: GenerationForm, count: number) =>
  appValueOf(field, NOTHING_LOADED, form, count);

describe('the app’s plan for a new FFA tournament', () => {
  it('lists every number of the app’s at 37', () => {
    expect(linesOf(ffa, 37)).toEqual([
      'Qualification: 4 rounds (app)',
      'Not counted: the first round (app)',
      'Rooms: 8 · 8 · 7 · 7 · 7 (app)',
      'In the bracket: 28 of 33 expected (app)',
      'Semis: 16 players (2 rooms of 8) (app)',
      'Final: 8 players (app)',
    ]);
  });

  it.each([
    [31, '8 · 8 · 8 · 7', '21 of 28'],
    [43, '8 · 7 · 7 · 7 · 7 · 7', '32 of 39'],
    [53, '8 · 8 · 8 · 8 · 7 · 7 · 7', '40 of 48'],
  ])('gives the rooms and the bracket at %i', (count, rooms, entry) => {
    expect(linesOf(ffa, count)).toEqual(
      expect.arrayContaining([`Rooms: ${rooms} (app)`, `In the bracket: ${entry} expected (app)`]),
    );
  });

  it('tags each typed number on its own line', () => {
    const typed = { ...ffa, qualRoundsOverride: '3', qualAdv: '30', finalOverride: '6' };
    expect(linesOf(typed, 43)).toEqual([
      'Qualification: 3 rounds (typed)',
      'Not counted: the first round (app)',
      'Rooms: 8 · 7 · 7 · 7 · 7 · 7 (app)',
      'In the bracket: 30 of 39 expected (typed)',
      'Semis: 16 players (2 rooms of 8) (app)',
      'Final: 6 players (typed)',
    ]);
  });

  it('shows the rooms a typed Semis size makes, equal or not', () => {
    expect(linesOf({ ...ffa, semisOverride: '14' }, 37)).toContain(
      'Semis: 14 players (2 rooms of 7) (typed)',
    );
    expect(linesOf({ ...ffa, semisOverride: '13' }, 37)).toContain('Semis: 13 players (7 · 6) (typed)');
  });

  it.each([
    ['0', 'none'],
    ['2', 'the first 2 rounds'],
  ])('words %s typed uncounted rounds as "%s"', (nonCountingRounds, words) => {
    expect(linesOf({ ...ffa, nonCountingRounds }, 37)[1]).toBe(`Not counted: ${words} (typed)`);
  });

  it('shows an older setup its own numbers as the app’s, and its stored "Advance to bracket" as typed', () => {
    const stored = createDefaultSetup({ poolingPhase: 'qual-table' });
    expect(linesOf(stored, 37).slice(0, 4)).toEqual([
      'Qualification: 3 rounds (app)',
      'Not counted: none (app)',
      'Rooms: 8 · 8 · 7 · 7 · 7 (app)',
      'In the bracket: 24 of 33 expected (typed)',
    ]);
  });
});

describe('the lines other formats have', () => {
  it('lists a Swiss, its equal rooms counted and its bye', () => {
    expect(linesOf(oneVOne, 37).slice(0, 3)).toEqual([
      'Swiss: 5 rounds (app)',
      'Not counted: none (app)',
      'Rooms: 18 rooms of 2, 1 bye (app)',
    ]);
  });

  it('counts equal rooms without a bye: 4 rooms of 8 at 32', () => {
    expect(linesOf(ffa, 32)).toContain('Rooms: 4 rooms of 8 (app)');
  });

  it('lists a group stage by its groups, with no bracket number when each group sends so many', () => {
    const groups = { ...oneVOne, poolingPhase: 'group-stage' as const };
    expect(linesOf(groups, 31)[0]).toBe('Group stage: groups of 4, 4, 4, 4, 4, 4, 4, 3 (app)');
    expect(labelsOf(groups, 31)).toEqual(['Group stage', 'Rooms', 'Semis', 'Final']);
  });

  it('has the bracket number when a group stage sends a total', () => {
    const total = { ...oneVOne, poolingPhase: 'group-stage' as const, groupExit: 'fair-cut' as const };
    expect(linesOf(total, 31)).toContain('In the bracket: 22 of 28 expected (app)');
  });

  it('has no pooling or bracket line with no pooling phase', () => {
    expect(labelsOf({ ...ffa, poolingPhase: 'none' }, 37)).toEqual(['Rooms', 'Semis', 'Final']);
  });

  it.each([
    ['layered', { ...ffa, scheduleLogic: 'layered' as const }],
    ['upper and lower', { ...oneVOne, scheduleLogic: 'upper-lower' as const }],
    [
      'Custom, after a table',
      {
        ...ffa,
        gameFormat: 'team-2v2v2v2' as const,
        teamScoringRule: 'sum-members' as const,
        scheduleLogic: 'waterfall-bracket' as const,
        waterfallGraph: TEAM_QUAL_GRAPH,
      },
    ],
  ])('leaves the bracket’s numbers to its own panel: %s', (_name, form) => {
    expect(labelsOf(form, 43)).toEqual([expect.any(String), 'Not counted', 'Rooms']);
  });

  it('has no Semis or Final line outside single elimination', () => {
    expect(labelsOf(shared, 53)).toEqual(['Qualification', 'Not counted', 'Rooms', 'In the bracket']);
  });

  it('lists typed survivor counts last, as typed', () => {
    const targets = { ...ffa, eliminationRoundTargets: '33,28,23,19,16' };
    expect(linesOf(targets, 53).at(-1)).toBe('Survivors: 33, 28, 23, 19, 16 (typed)');
  });
});

describe('appValueOf', () => {
  it.each([
    ['qualRoundsOverride', { ...ffa, qualRoundsOverride: '6' }, '4'],
    ['swissRoundsOverride', { ...oneVOne, swissRoundsOverride: '7' }, '5'],
    ['nonCountingRounds', { ...ffa, nonCountingRounds: '0' }, '1'],
    ['nonCountingRounds', { ...ffa, qualRoundsOverride: '1', nonCountingRounds: '0' }, '0'],
    ['semisOverride', { ...ffa, semisOverride: '6' }, '16'],
    ['finalOverride', { ...ffa, finalOverride: '6' }, '8'],
  ] as const)('reads the app’s %s whatever is typed (%#)', (field, form, expected) => {
    expect(appValue(field, form, 37)).toBe(expected);
  });

  it('gives 32 in the bracket at 43 while 30 is typed', () => {
    expect(appValue('qualAdv', { ...ffa, qualAdv: '30' }, 43)).toBe('32');
  });

  it.each([
    ['single elimination', ffa, '33, 28, 23, 19, 16'],
    ['a shared Final', shared, '31, 24, 18, 14, 12, 8, 6'],
  ])('gives survivor counts that, typed, build the same rounds: %s', (_name, form, expected) => {
    const survivors = appValue('eliminationRoundTargets', { ...form, eliminationRoundTargets: '20' }, 53);
    expect(survivors).toBe(expected);
    const typed = previewOf({ ...form, eliminationRoundTargets: survivors! }, 53).state.rounds;
    const own = previewOf(form, 53).state.rounds;
    expect(typed.map((round) => round.rooms)).toEqual(own.map((round) => round.rooms));
  });

  it('leaves the reseed modes out with the survivor counts they are listed by', () => {
    const form = { ...ffa, eliminationRoundTargets: '30,16', eliminationSeedingOverrides: 'random,' };
    expect(appValue('eliminationRoundTargets', form, 53)).toBe('33, 28, 23, 19, 16');
  });

  it('has none without an elimination round before the Semis', () => {
    expect(appValue('eliminationRoundTargets', ffa, 14)).toBeNull();
  });

  it('has none when the plan is refused', () => {
    expect(appValue('semisOverride', ffa, 11)).toBeNull();
    expect(generateTournament(NOTHING_LOADED, ffa, previewRuntime()).status).toBe('invalid');
  });
});
