import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { rosterKeys } from '../roster';
import { withFormMatchFormats } from '../round-match-formats';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { applyStageMatchEdit, stageMatchScope } from '../stage-match-edit';
import { readTournamentSettings } from '../tournament-settings';
import type { TournamentState } from '../types';
import { applyHandGraphEdit, bracketLogicOf } from '../upper-lower';
import { finalsMatchOf, serializeWaterfallDraft, waterfallDraftFromRounds } from '../waterfall-draft';
import { indexOf } from './dependency-play-fixtures';
import { rosterFor, testRuntime } from './test-fixtures';

type Setup = Parameters<typeof createDefaultSetup>[0];

function generate(count: number, setup: Setup) {
  const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
}

function built(count: number, setup: Setup): TournamentState {
  const result = generate(count, setup);
  if (result.status !== 'generated') throw new Error(result.message);
  return result.state;
}

const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;
const SWISS = { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye' } as const;
const GROUPS = {
  gameFormat: 'team-4v4',
  poolingPhase: 'group-stage',
  groupSize: '4',
  groupExit: 'fair-cut',
  oddCountStrategy: 'bye',
} as const;

const bracketRounds = (state: TournamentState) => state.rounds.filter((round) => round.isWaterfall);
const roomsOf = (state: TournamentState, label: string) => state.rounds[indexOf(state, label)].rooms;
const formatOf = (state: TournamentState, label: string) => {
  const round = state.rounds[indexOf(state, label)];
  return { bestOf: round.bestOf, numGames: round.numGames };
};

/** The graph text "Edit graph" opens on: read back off the rounds as they stand (`RunningWaterfallPanel`). */
function editedText(state: TournamentState): string {
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  return serializeWaterfallDraft(
    waterfallDraftFromRounds(state.rounds, {
      rankCount: rosterKeys(state.players).length,
      finalsMatch: finalsMatchOf(finalsGames, finalsBestOf),
    }),
  );
}

describe('generating an upper and lower bracket', () => {
  it('FFA 31 after a qualification table: a Custom bracket the app marks, rooms at the true sizes', () => {
    const state = built(31, QUAL);
    expect(state.scheduleLogic).toBe('waterfall-bracket');
    expect(bracketLogicOf(state)).toBe('upper-lower');
    expect(state.gamemodeConfig.upperLowerVersion).toBe(1);
    expect(state.gamemodeConfig.bracketPhase).toBe('waterfall-bracket');
    expect(state.settings?.scheduleLogic).toBe('upper-lower');
    expect(state.cfg.qualAdv).toBe(31);
    expect(roomsOf(state, 'Round 4 - Upper')).toEqual([8, 8]);
    expect(roomsOf(state, 'Round 4 - Lower')).toEqual([8, 7]);
    expect(roomsOf(state, 'Round 5 - Ranking')).toEqual([7]);
    expect(roomsOf(state, 'Round 6 - Ranking')).toEqual([8]);
  });

  it('FFA 37: 32 enter', () => {
    const state = built(37, QUAL);
    expect(state.cfg.qualAdv).toBe(32);
    expect(roomsOf(state, 'Round 4 - Lower')).toEqual([8, 8]);
  });

  it('1v1 Swiss at 9: 8 enter, numbered on from the Swiss rounds', () => {
    const state = built(9, SWISS);
    const first = state.rounds.findIndex((round) => round.isWaterfall);
    expect(state.cfg.qualAdv).toBe(8);
    expect(state.rounds[first - 1].isSwiss).toBe(true);
    expect(state.rounds[first].customLabel).toBe(`Round ${first + 1} - Upper`);
    expect(state.rounds[first - 1].standingsRoutes).toHaveLength(8);
  });

  it('4v4 group stage at 11: the Groups line takes 8 on', () => {
    const state = built(11, GROUPS);
    expect(state.cfg.qualAdv).toBe(8);
    expect(state.rounds.find((round) => round.isGroupStage && round.standingsRoutes)).toBeDefined();
    expect(bracketRounds(state).some((round) => round.customLabel === 'Final')).toBe(true);
  });

  it('the form is not changed: the graph text field stays whatever it was', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'upper-lower',
      ...QUAL,
      waterfallGraph: 'kept as typed',
    });
    generateTournament(
      createDefaultTournamentState({ confirmedCount: 31, players: rosterFor(form.gameFormat, 31) }),
      form,
      testRuntime(),
    );
    expect(form.waterfallGraph).toBe('kept as typed');
  });

  it('Copy settings carries the choice, and the new tournament works its own rooms out', () => {
    const copied = readTournamentSettings(built(31, QUAL).settings);
    expect(copied?.scheduleLogic).toBe('upper-lower');
    const again = built(37, { ...QUAL, ...(copied as Setup) });
    expect(again.cfg.qualAdv).toBe(32);
    expect(roomsOf(again, 'Round 4 - Lower')).toEqual([8, 8]);
  });
});

describe('what an upper and lower bracket refuses', () => {
  it('no pooling phase', () => {
    expect(generate(31, { ...QUAL, poolingPhase: 'none' })).toEqual({
      status: 'invalid',
      message:
        'An upper and lower bracket splits the qualifiers by their pooling place: choose a Qualification Table, a Swiss or a Group Stage.',
    });
  });

  it('a count under the floor, in the words of the floor', () => {
    expect(generate(11, QUAL)).toEqual({
      status: 'invalid',
      message: 'This format needs at least 12 registered players. Registered: 11.',
    });
  });

  it('an "Advance to bracket" that makes no bracket, naming the numbers that work', () => {
    expect(generate(30, { ...QUAL, upperLowerAdvance: '20' })).toEqual({
      status: 'invalid',
      message: 'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
    });
    expect(generate(30, { ...QUAL, upperLowerAdvance: 'many' })).toMatchObject({ status: 'invalid' });
  });

  it('a per-group exit the groups cannot share: 3 groups, 8 teams', () => {
    expect(generate(11, { ...GROUPS, groupExit: 'per-group' })).toEqual({
      status: 'invalid',
      message:
        "An upper and lower bracket takes 8 teams, and 3 groups can't each send the same number: choose Even split or Fair cut.",
    });
  });

  it('a per-group exit the groups share is taken: 4 groups, 2 each', () => {
    const state = built(16, { ...GROUPS, groupExit: 'per-group' });
    expect(state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes).toHaveLength(8);
    expect(state.cfg.qualifiersPerGroup).toBe(2);
  });

  it('Advance to bracket lowers what enters, and above the head count means everyone', () => {
    expect(built(31, { ...QUAL, upperLowerAdvance: '28' }).cfg.qualAdv).toBe(28);
    expect(built(31, { ...QUAL, upperLowerAdvance: '99' }).cfg.qualAdv).toBe(31);
  });
});

describe('the match formats of an upper and lower bracket', () => {
  const state = built(31, QUAL);

  it('marks every round but the Final with its stage', () => {
    const stages = Object.fromEntries(
      bracketRounds(state).map((round) => [round.customLabel, round.graphMatchStage]),
    );
    expect(stages).toMatchObject({
      'Round 4 - Upper': 'bracket',
      'Round 5 - Ranking': 'bracket',
      'Semi-Final A': 'semis',
      'Semi-Final B': 'semis',
    });
    expect(stages.Final).toBeUndefined();
  });

  it('Semis Best of 3 reaches both Semi-Finals only', () => {
    const current = built(31, { ...QUAL, semisBestOf: '3' });
    expect(formatOf(current, 'Semi-Final A').bestOf).toBe(3);
    expect(formatOf(current, 'Semi-Final B').bestOf).toBe(3);
    expect(formatOf(current, 'Round 4 - Upper').bestOf).toBeUndefined();
    expect(formatOf(current, 'Final').bestOf).toBeUndefined();
  });

  it('the upper and lower rounds format reaches every other round, ranking rooms included, never the Final or a Semi-Final', () => {
    const current = built(31, { ...QUAL, bracketGames: '2' });
    const others = [
      'Round 4 - Upper',
      'Round 4 - Lower',
      'Round 5 - Lower',
      'Round 5 - Ranking',
      'Round 6 - Ranking',
    ];
    for (const label of others) expect(formatOf(current, label).numGames, label).toBe(2);
    expect(formatOf(current, 'Semi-Final A').numGames).toBe(1);
    expect(formatOf(current, 'Final').numGames).toBe(3);
  });

  it('the Finals format reaches the Final', () => {
    expect(formatOf(built(31, { ...QUAL, finalsBestOf: '5' }), 'Final').bestOf).toBe(5);
  });

  it('a per-round override wins over its stage', () => {
    const current = built(31, { ...QUAL, bracketGames: '2', matchOverrides: 'Round 4 - Lower: BO3' });
    expect(formatOf(current, 'Round 4 - Lower').bestOf).toBe(3);
    expect(formatOf(current, 'Round 4 - Upper').numGames).toBe(2);
  });

  it.each([
    ['the Semis', { semisBestOf: '3' }, 'Semi-Final B', { bestOf: 3 }],
    ['the rounds', { bracketGames: '3' }, 'Round 5 - Lower', { numGames: 3 }],
    ['the Finals', { finalsGames: '2' }, 'Final', { numGames: 2 }],
    ['one round', { matchOverrides: 'Round 5 - Lower: BO5' }, 'Round 5 - Lower', { bestOf: 5 }],
  ])('a change of %s before the start formats the drawn rounds', (_what, change, label, expected) => {
    const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...QUAL, ...change });
    const changed = withFormMatchFormats(state, form);
    expect(formatOf(changed, label)).toMatchObject(expected);
    expect(changed.scheduleLogic).toBe('waterfall-bracket');
    expect(changed.settings?.scheduleLogic).toBe('upper-lower');
  });

  it('lists the rounds and stages in the running "Match format" panel', () => {
    const scope = stageMatchScope({ ...state, started: true });
    expect(scope.kind).toBe('stages');
    if (scope.kind !== 'stages') return;
    expect(scope.stages.map((entry) => [entry.stage, entry.label])).toEqual(
      expect.arrayContaining([
        ['bracket', 'Upper and lower rounds'],
        ['semis', 'Semis'],
      ]),
    );
    expect(scope.rounds.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['Round 4 - Upper', 'Semi-Final A', 'Round 5 - Ranking']),
    );
  });

  it('a live change of the Semis and of one round formats them', () => {
    const result = applyStageMatchEdit(
      { ...state, started: true },
      { semis: { games: 1, bestOf: 3 } },
      { 'Round 5 - Lower': { games: 2 } },
    );
    expect(result.ok ? '' : result.error).toBe('');
    if (!result.ok) return;
    expect(formatOf(result.state, 'Semi-Final A').bestOf).toBe(3);
    expect(formatOf(result.state, 'Round 5 - Lower').numGames).toBe(2);
    expect(result.state.gamemodeConfig.upperLowerVersion).toBe(1);
  });
});

describe('a hand edit makes it a Custom bracket for good', () => {
  it('applyHandGraphEdit drops the version and the stages, reads Custom bracket in the snapshot, and keeps the formats', () => {
    const started = { ...built(31, { ...QUAL, semisBestOf: '3' }), started: true };
    const edited = applyHandGraphEdit(started, editedText(started));
    expect(edited.ok ? '' : edited.error).toBe('');
    if (!edited.ok) return;
    expect(bracketLogicOf(edited.state)).toBe('waterfall-bracket');
    expect(edited.state.gamemodeConfig.upperLowerVersion).toBeUndefined();
    expect(edited.state.settings?.scheduleLogic).toBe('waterfall-bracket');
    expect(edited.state.rounds.some((round) => round.graphMatchStage !== undefined)).toBe(false);
    expect(formatOf(edited.state, 'Semi-Final A').bestOf).toBe(3);
    expect(edited.state.settings?.waterfallGraph).toContain('Semi-Final A');
  });

  it('leaves a Custom bracket as applyWaterfallGraphEdit does', () => {
    const state = built(31, QUAL);
    const { upperLowerVersion: _version, ...gamemodeConfig } = state.gamemodeConfig;
    const custom = { ...state, gamemodeConfig, started: true };
    const edited = applyHandGraphEdit(custom, editedText(custom));
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.state.settings?.scheduleLogic).toBe('upper-lower');
  });
});
