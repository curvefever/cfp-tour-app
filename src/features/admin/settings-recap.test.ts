import { describe, expect, it } from 'vitest';
import { GAME_FORMATS } from '../../domain/tournament/formats';
import { QUAL_GRAPH as GENERATING_QUAL_GRAPH } from '../../domain/tournament/__tests__/qual-waterfall';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
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

const UPPER_LOWER_GROUPS = {
  scheduleLogic: 'upper-lower',
  poolingPhase: 'group-stage',
  gameFormat: 'team-4v4',
} as const satisfies Partial<PersistedSetup>;

const groupItems = (state: TournamentState) => itemsOf(settingsRecapGroups(state));

function titles(groups: RecapGroup[]) {
  return groups.map((group) => group.title);
}

function itemsOf(groups: RecapGroup[]): Record<string, string> {
  return Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.label, item.value])));
}

describe('settingsRecapGroups', () => {
  it('reads an empty "Advance to bracket" as the number the tournament was generated with', () => {
    const setup = { poolingPhase: 'qual-table', qualAdv: '' } as const;
    const generated = { ...stateOf(setup), cfg: { qualAdv: 28 } };
    expect(itemsOf(settingsRecapGroups(generated))['Advance to bracket']).toBe('28 (automatic)');
    const typed = { ...stateOf({ ...setup, qualAdv: '24' }), cfg: { qualAdv: 24 } };
    expect(itemsOf(settingsRecapGroups(typed))['Advance to bracket']).toBe('24');
  });

  it('reads an empty group stage total the same way', () => {
    const setup = {
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      groupExit: 'fair-cut',
    } as const;
    const generated = { ...stateOf({ ...setup, qualAdv: '' }), cfg: { qualAdv: 10 } };
    expect(groupItems(generated)['Advance to bracket']).toBe('10 (automatic) in all');
    const typed = { ...stateOf({ ...setup, qualAdv: '8' }), cfg: { qualAdv: 8 } };
    expect(groupItems(typed)['Advance to bracket']).toBe('8 in all');
  });

  it('words a Best of N Semis and Final as Best of N, not as summed games', () => {
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({
          scheduleLogic: 'single-elimination',
          semisGames: '2',
          semisBestOf: '3',
          finalsGames: '3',
          finalsBestOf: '5',
        }),
      ),
    );
    expect(items['Semis format']).toBe('Best of 3');
    expect(items['Finals format']).toBe('Best of 5');
    expect(items['semisBestOf']).toBeUndefined();
  });

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
    expect(items['Game format']).toBe('FFA · rooms of 6–8');
    expect(items['Pooling phase']).toBe('Qualification Table');
    expect(items['Advance to bracket']).toBe('24');
    expect(items['Non-counting rounds']).toBe('None');
    expect(items['Semis format']).toBe('2 games (sum)');
    expect(items['Finals format']).toBe('3 games (sum)');
    expect(items['Roster']).toBe('37 players · 2 reserves');
    expect(items['Grand Final, winners bracket']).toBeUndefined();
    expect(items['Group size']).toBeUndefined();
  });

  it('names match results with their points and tie margin on the scoring row, and lists no row of their own', () => {
    const state = stateOf(
      {
        gameFormat: 'team-4v4',
        poolingPhase: 'group-stage',
        scoring: 'match-results',
        matchResultPoints: '5, 3, 2, 0',
      },
      { confirmed: 10 },
    );
    const generated = {
      ...state,
      gamemodeConfig: {
        ...state.gamemodeConfig,
        scoring: 'match-results' as const,
        matchResultPoints: [5, 3, 2, 0] as [number, number, number, number],
        tieMargin: 100,
      },
    };
    const items = itemsOf(settingsRecapGroups(generated));
    expect(items['Scoring system']).toBe('Match results: 5 / 3 / 2 / 0, tie margin 100');
    expect(items['Match result points']).toBeUndefined();
    expect(items['Tie margin']).toBeUndefined();
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

  it('reads the advancing count of a Swiss off its graph, with a Qual line or without one (the top N into the entry round)', () => {
    const setup = { scheduleLogic: 'waterfall-bracket', poolingPhase: 'swiss', qualAdv: '99' } as const;
    const withLine = itemsOf(settingsRecapGroups(stateOf({ ...setup, waterfallGraph: QUAL_GRAPH })));
    expect(withLine['Advance to bracket']).toBe('24, set by the custom bracket graph');
    // One entry round of 16 seats and no Qual line: read as the top 16 into it.
    const oneEntryRound = 'ROUNDS:\nR1 = 2x8\nFinal = 8 FINAL\n\nROUTES:\nR1.A: 1-4->Final\nR1.B: 1-4->Final';
    const withoutLine = itemsOf(settingsRecapGroups(stateOf({ ...setup, waterfallGraph: oneEntryRound })));
    expect(withoutLine['Advance to bracket']).toBe('16, set by the custom bracket graph');
  });
});

describe('the recap of a Swiss into a Custom bracket graph with no Qual line', () => {
  it('reads "Advance to bracket" off the graph: the top 4 into the entry round of 4 seats', () => {
    const graph = [
      'ROUNDS:',
      'R6 = 2x2',
      'QF = 2x2',
      'Final = 2 FINAL',
      '',
      'ROUTES:',
      'R6.A: 1-2->QF',
      'R6.B: 1-2->QF',
      'QF.A: 1->Final',
      'QF.B: 1->Final',
    ].join('\n');
    const items = itemsOf(
      settingsRecapGroups(
        stateOf({
          scheduleLogic: 'waterfall-bracket',
          poolingPhase: 'swiss',
          qualAdv: '9',
          waterfallGraph: graph,
        }),
      ),
    );
    expect(items['Advance to bracket']).toBe('4, set by the custom bracket graph');
  });
});

describe('the recap of an upper and lower bracket after a group stage', () => {
  it('lists the exit the bracket takes automatically: qualifiers per group, or the total, beside its own Advance to bracket', () => {
    const perGroup = groupItems(stateOf({ ...UPPER_LOWER_GROUPS, groupExit: 'per-group' }));
    expect(perGroup['Teams out of the groups']).toBeDefined();
    expect(perGroup['Qualifiers per group']).toBe('2');
    expect(perGroup['Advance to bracket']).toBe('Automatic');
    for (const groupExit of ['even-split', 'fair-cut'] as const) {
      const items = groupItems(stateOf({ ...UPPER_LOWER_GROUPS, groupExit, qualAdv: '8' }));
      expect(items['Total out of the groups'], groupExit).toBe('8 in all');
      expect(items['Advance to bracket'], groupExit).toBe('Automatic');
      expect(items['Qualifiers per group'], groupExit).toBeUndefined();
    }
  });

  it('lists one "Advance to bracket" row: the total of the groups is named apart', () => {
    const groups = settingsRecapGroups(
      stateOf({ ...UPPER_LOWER_GROUPS, groupExit: 'even-split', qualAdv: '24' }),
    );
    const labels = groups.flatMap((group) => group.items.map((item) => item.label));
    expect(labels.filter((label) => label === 'Advance to bracket')).toHaveLength(1);
    expect(itemsOf(groups)['Advance to bracket']).toBe('Automatic');
  });
});

describe('the recap of a layered bracket', () => {
  const layered = {
    scheduleLogic: 'layered',
    gameFormat: 'ffa-individual',
    poolingPhase: 'qual-table',
  } as const satisfies Partial<PersistedSetup>;

  it('has no "Advance to bracket" line: Setup hides it and the plan works the number out', () => {
    const labels = settingsRecapGroups(stateOf({ ...layered, qualAdv: '24' })).flatMap((group) =>
      group.items.map((item) => item.label),
    );
    expect(labels).not.toContain('Advance to bracket');
    expect(labels).not.toContain('Qualifiers per group');
  });

  it('lists the five numbers, "Automatic" where nothing was typed, and the formats of the bracket rounds', () => {
    const items = groupItems(stateOf({ ...layered, layeredExpected: '26', layeredLevels: '3' }));
    expect(items['Expected to play']).toBe('26');
    expect(items['Levels']).toBe('3');
    expect(items['In the bracket']).toBe('Automatic');
    expect(items['Bracket rounds']).toBe('Automatic');
    expect(items['Top level']).toBe('Automatic');
    expect(items['Bracket rounds format']).toBe('Single game');
  });

  it('lists the typed top places of each room and the other half of Semi-Final A', () => {
    const items = groupItems(
      stateOf({
        ...layered,
        layeredTopCounts: 'Round 4 - Lower: 4\nRound 5 - Lower: 3',
        layeredSemiOthers: 'wait',
      }),
    );
    expect(items['Top places of each room']).toBe('Round 4 - Lower: 4, Round 5 - Lower: 3');
    expect(items['Semi-Final A, the other half']).toBe('Wait');
    const none = groupItems(stateOf(layered));
    expect(none['Top places of each room']).toBe('Automatic');
    expect(none['Semi-Final A, the other half']).toBe('Automatic');
  });

  it('names the schedule logic', () => {
    expect(groupItems(stateOf(layered))['Schedule logic']).toBe('Layered bracket');
  });
});

describe('the recap of pooling numbers left to the app', () => {
  const itemsAt = (setup: Partial<PersistedSetup>, n: number | undefined) =>
    groupItems({ ...stateOf(setup), cfg: n === undefined ? {} : { n } });
  const table = { poolingPhase: 'qual-table', nonCountingRounds: '' } as const;
  const swiss = { gameFormat: 'individual-1v1', poolingPhase: 'swiss', nonCountingRounds: '' } as const;

  it('words a new tournament’s table: 4 rounds and 1 not counted, both the app’s', () => {
    const items = itemsAt({ ...table, poolingDefaultsVersion: '1' }, 37);
    expect(items['Qualification rounds']).toBe('4 (automatic)');
    expect(items['Non-counting rounds']).toBe('1 (automatic)');
  });

  it('words its Swiss: 5 rounds, none uncounted', () => {
    const items = itemsAt({ ...swiss, poolingDefaultsVersion: '1' }, 37);
    expect(items['Swiss rounds']).toBe('5 (automatic)');
    expect(items['Non-counting rounds']).toBe('None (automatic)');
  });

  it('gives an older setup its own numbers: 3 table rounds, a Swiss from the field, and a stored 0', () => {
    expect(itemsAt(table, 37)['Qualification rounds']).toBe('3 (automatic)');
    expect(itemsAt(swiss, 37)['Swiss rounds']).toBe('6 (automatic)');
    expect(itemsAt({ ...table, nonCountingRounds: '0' }, 37)['Non-counting rounds']).toBe('None');
  });

  it('keeps typed numbers as typed', () => {
    const typed = { ...table, poolingDefaultsVersion: '1', qualRoundsOverride: '6', nonCountingRounds: '2' };
    const items = itemsAt(typed, 37);
    expect(items['Qualification rounds']).toBe('6');
    expect(items['Non-counting rounds']).toBe('2');
  });

  it('shows a dash before there is a head count', () => {
    expect(itemsAt({ ...table, poolingDefaultsVersion: '1' }, undefined)['Qualification rounds']).toBe('—');
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
    'upper-lower',
    'layered',
  ];
  const poolings: PersistedSetup['poolingPhase'][] = ['none', 'qual-table', 'swiss', 'group-stage'];
  const scorings: PersistedSetup['scoring'][] = ['fairpoints', 'positional-points', 'match-results'];
  const choices = formats.flatMap((gameFormat) =>
    logics.flatMap((scheduleLogic) =>
      poolings.flatMap((poolingPhase) =>
        scorings.map((scoring) => ({ gameFormat, scheduleLogic, poolingPhase, scoring })),
      ),
    ),
  );

  it('applies every Setup setting to some combination of choices', () => {
    const applied = new Set<string>(choices.flatMap((choice) => [...visibleFormatFields(choice)]));
    // The pooling switch is stored with the settings but is no field of the form.
    const fields = SETTING_KEYS.filter((key) => key !== 'poolingDefaultsVersion');
    for (const key of [...fields, 'lbQualifiers']) expect(applied).toContain(key);
  });

  it('lists exactly the settings Setup shows for any combination of choices', () => {
    for (const choice of choices) {
      const groups = settingsRecapGroups(stateOf(choice));
      const listed = groups.filter((group) => group.title !== 'ROSTER AND SHARING');
      // The Best of N settings are read through the Semis and Finals format rows, and the match-result settings through the scoring row, not listed of their own.
      const shown = [...visibleFormatFields(choice)].filter(
        (field) =>
          !field.endsWith('BestOf') &&
          field !== 'matchResultPoints' &&
          field !== 'tieMargin' &&
          field !== 'waterfallNumberedFrom' &&
          !field.startsWith('finalsUneven') &&
          field !== 'finalsUpperWins' &&
          field !== 'finalsLowerWins',
      );
      expect(listed.flatMap((group) => group.items)).toHaveLength(shown.length);
    }
  });
});

describe('the recap of an upper and lower bracket with an uneven-wins Final', () => {
  const unevenOf = (settings: Partial<PersistedSetup>) =>
    itemsOf(
      settingsRecapGroups(
        stateOf({
          scheduleLogic: 'upper-lower',
          poolingPhase: 'swiss',
          gameFormat: 'individual-1v1',
          oddCountStrategy: 'bye',
          ...settings,
        }),
      ),
    )['Finals format'];

  it('words the Finals format as the two numbers, an empty box as its default', () => {
    expect(unevenOf({ finalsUnevenWins: 'yes' })).toBe(
      'Uneven wins: upper finalist needs 1, lower finalist needs 2',
    );
    expect(unevenOf({ finalsUnevenWins: 'yes', finalsUpperWins: '2', finalsLowerWins: '3' })).toBe(
      'Uneven wins: upper finalist needs 2, lower finalist needs 3',
    );
  });

  it('words the Finals format as before when the option is off, or in a format that has none', () => {
    expect(unevenOf({ finalsGames: '3' })).toBe('3 games (sum)');
    expect(
      unevenOf({ finalsUnevenWins: 'yes', gameFormat: 'ffa-individual', poolingPhase: 'qual-table' }),
    ).toBe('3 games (sum)');
  });
});

describe('the match format of every stage in the recap', () => {
  function generated(count: number, setup: Partial<PersistedSetup>): TournamentState {
    const result = generateTournament(
      createDefaultTournamentState({
        confirmedCount: count,
        players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
      }),
      createDefaultSetup({ gameFormat: 'individual-1v1', ...setup }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
    return result.state;
  }

  it('lists the pooling, elimination and Semis formats of single elimination, and the round overrides in schedule order', () => {
    const items = itemsOf(
      settingsRecapGroups(
        generated(37, {
          scheduleLogic: 'single-elimination',
          poolingBestOf: '3',
          bracketGames: '2',
          semisBestOf: '3',
          matchOverrides: 'Semis: GAMES 2\nRound 3: BO3\nRound 99: BO5',
        }),
      ),
    );
    expect(items['Pooling rounds']).toBe('Best of 3');
    expect(items['Elimination rounds']).toBe('2 games (sum)');
    expect(items['Semis format']).toBe('Best of 3');
    expect(items['Round overrides']).toBe('Round 3: Best of 3, Semis: 2 games');
    expect(items['Losers rounds']).toBeUndefined();
  });

  it('names the stage after the schedule: winners rounds and losers rounds, ladder rounds', () => {
    const shared = itemsOf(
      settingsRecapGroups(
        generated(37, {
          gameFormat: 'ffa-individual',
          scheduleLogic: 'double-elimination-shared-final',
          losersBestOf: '5',
        }),
      ),
    );
    expect(shared['Winners rounds']).toBe('Single game');
    expect(shared['Losers rounds']).toBe('Best of 5');
    expect(shared['Elimination rounds']).toBeUndefined();
    const kings = itemsOf(
      settingsRecapGroups(
        generated(24, { scheduleLogic: 'kings-valley', gameFormat: 'ffa-individual', bracketBestOf: '3' }),
      ),
    );
    expect(kings['Ladder rounds']).toBe('Best of 3');
    expect(kings['Losers rounds']).toBeUndefined();
  });

  it('shows no override line text for none, and no stage line for a Custom bracket graph', () => {
    const items = itemsOf(settingsRecapGroups(generated(37, { scheduleLogic: 'single-elimination' })));
    expect(items['Round overrides']).toBe('—');
    expect(items['Pooling rounds']).toBe('Single game');
    const custom = itemsOf(
      settingsRecapGroups(
        generated(37, {
          gameFormat: 'ffa-individual',
          scheduleLogic: 'waterfall-bracket',
          poolingPhase: 'qual-table',
          qualAdv: '99',
          waterfallGraph: GENERATING_QUAL_GRAPH,
        }),
      ),
    );
    expect(custom['Elimination rounds']).toBeUndefined();
    expect(custom['Winners rounds']).toBeUndefined();
  });
});
