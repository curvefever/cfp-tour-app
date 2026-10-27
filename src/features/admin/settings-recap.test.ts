import { describe, expect, it } from 'vitest';
import { GAME_FORMATS } from '../../domain/tournament/formats';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { SETTING_KEYS, settingsFromForm } from '../../domain/tournament/tournament-settings';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { settingsRecapGroups, type RecapGroup } from './settings-recap';
import { visibleFormatFields } from './setup/format-fields';

const QUAL_GRAPH = `
ROUNDS:
R1 = 2x8
R1C = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C
R1.A: 1-4->Final, 5-8->eliminated
R1.B: 1-4->Final, 5-8->eliminated
R1C: 1-4->Final, 5-8->eliminated
`;

function stateOf(
  setup: Partial<PersistedSetup>,
  roster: { confirmed: number; reserves?: string[] } = { confirmed: 37, reserves: ['Larch', 'Nimbus'] },
): TournamentState {
  const form = createDefaultSetup(setup);
  return createDefaultTournamentState({
    gameFormat: form.gameFormat,
    scheduleLogic: form.scheduleLogic,
    settings: settingsFromForm(form),
    confirmedCount: roster.confirmed,
    reserves: roster.reserves ?? [],
  });
}

function titles(groups: RecapGroup[]) {
  return groups.map((group) => group.title);
}

function itemsOf(groups: RecapGroup[]): Record<string, string> {
  return Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.label, item.value])));
}

describe('settingsRecapGroups', () => {
  it('lists an FFA qualification table into single elimination, then the roster and the link', () => {
    const groups = settingsRecapGroups(
      stateOf({
        poolingPhase: 'qual-table',
        qualAdv: '24',
        scheduleLogic: 'single-elimination',
        semisGames: '2',
        finalsGames: '3',
      }),
    );
    expect(titles(groups)).toEqual(['FORMAT', 'POOLING', 'SCORING', 'BRACKET', 'ROSTER AND SHARING']);
    const items = itemsOf(groups);
    expect(items['Game format']).toBe('FFA — Individual · rooms of 6–8');
    expect(items['Pooling phase']).toBe('Qualification Table');
    expect(items['Advance to bracket']).toBe('24');
    expect(items['Non-counting rounds']).toBe('None');
    expect(items['Semis format']).toBe('2 games (sum)');
    expect(items['Finals format']).toBe('3 games (sum)');
    expect(items['Roster']).toBe('37 players · 2 reserves');
    expect(items['Grand Final, winners bracket']).toBeUndefined();
    expect(items['Group size']).toBeUndefined();
  });

  it('names Standard points as the scaled rule for a tournament with pointsVersion 2, and as before without it', () => {
    const state = stateOf({ poolingPhase: 'qual-table', qualAdv: '24' });
    const scaled = { ...state, gamemodeConfig: { ...state.gamemodeConfig, pointsVersion: 2 as const } };
    expect(itemsOf(settingsRecapGroups(scaled))['Scoring system']).toBe(
      'Standard points (FFA: 10, 8, 6, 5, 4, 3, 2, 1; other formats: 1st = largest room size, −1 per place; smaller rooms scaled)',
    );
    expect(itemsOf(settingsRecapGroups(state))['Scoring system']).toBe(
      'Standard points (1st = largest room size, −1 per place)',
    );
  });

  it('names the team scoring of 2v2v2v2 Save your Buddy, and counts teams', () => {
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({ gameFormat: 'team-2v2v2v2', teamScoringRule: 'designated-player' }, { confirmed: 13 }),
      ),
    );
    expect(items['Team scoring']).toBe('Save your Buddy (defender only)');
    expect(items['Roster']).toBe('13 teams');
  });

  it('lists a 1v1 Swiss double elimination with its Grand Final targets and no Semis', () => {
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({
          gameFormat: 'individual-1v1',
          poolingPhase: 'swiss',
          scheduleLogic: 'double-elimination',
          grandFinalWbTarget: '1',
          grandFinalLbTarget: '2',
          swissRoundsOverride: '5',
          oddCountStrategy: 'bye',
        }),
      ),
    );
    expect(items['Grand Final, winners bracket']).toBe('1 wins needed');
    expect(items['Grand Final, losers bracket']).toBe('2 wins needed');
    expect(items['Swiss rounds']).toBe('5');
    expect(items['Odd-count strategy']).toBe('Bye — a team can sit out a round when needed');
    expect(items['Finals format']).toBeUndefined();
    expect(items['Semis format']).toBeUndefined();
    expect(items['Qualification rounds']).toBeUndefined();
  });

  it('lists Kings Valley without a pooling phase or a Semis', () => {
    const groups = settingsRecapGroups(stateOf({ scheduleLogic: 'kings-valley', poolingPhase: 'none' }));
    const items = itemsOf(groups);
    expect(items['Schedule logic']).toBe('Kings Valley');
    expect(items['Pooling phase']).toBe('None — standard elimination from R1');
    expect(items['Advance to bracket']).toBeUndefined();
    expect(items['Draw publication']).toBeUndefined();
    expect(items['Semis format']).toBeUndefined();
    expect(items['Scoring system']).toBe('Standard points (1st = largest room size, −1 per place)');
  });

  it('shows Standard points with no pooling phase, whatever scoring an earlier choice left behind', () => {
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({ poolingPhase: 'none', scoring: 'positional-points', positionalPointsTable: '3,2,1' }),
      ),
    );
    expect(items['Scoring system']).toBe('Standard points (1st = largest room size, −1 per place)');
    expect(items['Points table']).toBeUndefined();
  });

  it('shows the custom points table with a pooling phase', () => {
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({ poolingPhase: 'qual-table', scoring: 'positional-points', positionalPointsTable: '3,2,1' }),
      ),
    );
    expect(items['Scoring system']).toBe('Custom points table');
    expect(items['Points table']).toBe('3,2,1');
  });

  it('reads the advancing count of a waterfall with a Qual source off its graph', () => {
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({
          scheduleLogic: 'waterfall-bracket',
          poolingPhase: 'qual-table',
          qualAdv: '99',
          waterfallGraph: QUAL_GRAPH,
        }),
      ),
    );
    expect(items['Advance to bracket']).toBe('24, set by the custom bracket graph');
    expect(items['Custom bracket graph']).toBeDefined();
  });

  it('lists a tournament stored before the settings snapshot from what its state records', () => {
    const state = {
      ...stateOf({ poolingPhase: 'qual-table' }),
      settings: undefined,
      cfg: { poolingPhase: 'qual-table', qualAdv: 16 },
    } as TournamentState;
    const items = itemsOf(settingsRecapGroups(state));
    expect(items['Pooling phase']).toBe('Qualification Table');
    expect(items['Advance to bracket']).toBe('16');
  });
});

describe('the recap against the Setup form', () => {
  const formats = Object.keys(GAME_FORMATS) as PersistedSetup['gameFormat'][];
  const logics: PersistedSetup['scheduleLogic'][] = [
    'single-elimination',
    'double-elimination',
    'double-elimination-shared-final',
    'kings-valley',
    'waterfall-bracket',
  ];
  const poolings: PersistedSetup['poolingPhase'][] = ['none', 'qual-table', 'swiss', 'group-stage'];
  const scorings: PersistedSetup['scoring'][] = ['fairpoints', 'positional-points'];
  const choices = formats.flatMap((gameFormat) =>
    logics.flatMap((scheduleLogic) =>
      poolings.flatMap((poolingPhase) =>
        scorings.map((scoring) => ({ gameFormat, scheduleLogic, poolingPhase, scoring })),
      ),
    ),
  );

  it('applies every Setup setting to some combination of choices', () => {
    const applied = new Set<string>(choices.flatMap((choice) => [...visibleFormatFields(choice)]));
    for (const key of [...SETTING_KEYS, 'lbQualifiers']) expect(applied).toContain(key);
  });

  it('lists exactly the settings Setup shows for any combination of choices', () => {
    for (const choice of choices) {
      const groups = settingsRecapGroups(stateOf(choice));
      const listed = groups.filter((group) => group.title !== 'ROSTER AND SHARING');
      expect(listed.flatMap((group) => group.items)).toHaveLength(visibleFormatFields(choice).size);
    }
  });
});
