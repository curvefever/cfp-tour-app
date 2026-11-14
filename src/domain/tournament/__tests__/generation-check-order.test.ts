import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { PersistedSetup } from '../types';
import { rosterFor } from './test-fixtures';

/**
 * Which refusal the organiser sees when two settings are both wrong is the order of `generateTournament`'s
 * checks (cleanup audit C1-1). Each check is broken alone first (its own message), then two checks that follow
 * each other in the function are broken in one setup: the earlier one's message must come out.
 *
 * Checks that cannot be broken together (the same setting, a format that is head-to-head and not, or branches
 * of one if/else) have no pair; the comment above `describe` of the pairs says why, so a pair is not missing by accident.
 */

interface Attempt {
  count?: number;
  form?: Partial<PersistedSetup>;
  /** `none`: no roster loaded; `teams`: a roster of teams that doesn't fit the form's individual format. */
  roster?: 'none' | 'teams';
}

function refusal({ count = 37, form = {}, roster }: Attempt): string | null {
  const setup = createDefaultSetup(form);
  const players = roster === 'teams' ? rosterFor('team-2v2', count) : rosterFor(setup.gameFormat, count);
  const state = createDefaultTournamentState({
    confirmedCount: roster === 'none' ? null : count,
    players,
  });
  const result = generateTournament(state, setup, createTournamentRuntime());
  return result.status === 'invalid' ? result.message : null;
}

interface Check {
  /** What breaks the check, on top of a valid 37-player FFA single elimination. */
  breaks: Attempt;
  message: RegExp;
}

const ONE_V_ONE: Partial<PersistedSetup> = { gameFormat: 'individual-1v1' };
const GROUPS_OF_ONE_V_ONE: Partial<PersistedSetup> = { ...ONE_V_ONE, poolingPhase: 'group-stage' };
const MATCH_RESULTS: Partial<PersistedSetup> = { scoring: 'match-results', poolingPhase: 'qual-table' };
const POSITIONAL: Partial<PersistedSetup> = { scoring: 'positional-points', poolingPhase: 'qual-table' };
const SHARED_FINAL: Partial<PersistedSetup> = { scheduleLogic: 'double-elimination-shared-final' };

/** 8 units through two bands; sent on by a Groups line, not shareable between 3 groups. */
const TWO_BANDS = `
ROUNDS:
R1 = 2x2
R1C = 2x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
Groups: 1-4->R1, 5-8->R1C
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1C.A: 1->R2, 2->eliminated
R1C.B: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;

/** In the order the checks run today. */
const CHECKS = {
  noRoster: { breaks: { roster: 'none' }, message: /Load a roster first/ },
  unknownFormat: {
    breaks: { form: { gameFormat: 'no-such-format' as never } },
    message: /game format is not available yet/,
  },
  rosterOfAnotherFormat: { breaks: { roster: 'teams' }, message: /loaded for a different game format/ },
  belowFloor: { breaks: { count: 10 }, message: /needs at least 12 registered players/ },
  swissNotHeadToHead: { breaks: { form: { poolingPhase: 'swiss' } }, message: /Swiss isn't available/ },
  groupStageNotHeadToHead: {
    breaks: { form: { poolingPhase: 'group-stage' } },
    message: /Group Stage isn't available/,
  },
  groupSizeBelowMinimum: {
    breaks: { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, groupSize: '1' } },
    message: /Group size must be at least/,
  },
  groupSizeAboveMaximum: {
    breaks: { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, groupSize: '99' } },
    message: /Group size can't exceed/,
  },
  qualifiersPerGroupTooMany: {
    breaks: { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, qualifiersPerGroup: '9' } },
    message: /Qualifiers per group \(9\) is more than/,
  },
  upperLowerPlan: {
    breaks: { form: { scheduleLogic: 'upper-lower', poolingPhase: 'qual-table', upperLowerAdvance: '3' } },
    message: /has no upper and lower bracket/,
  },
  graphBlankWithQualSource: {
    breaks: { form: { scheduleLogic: 'waterfall-bracket', poolingPhase: 'qual-table' } },
    message: /Custom bracket needs its rounds and routing/,
  },
  graphBlankWithGroupsSource: {
    breaks: { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, scheduleLogic: 'waterfall-bracket' } },
    message: /Custom bracket needs its rounds and routing/,
  },
  groupsLineNotShareable: {
    breaks: {
      count: 13,
      form: {
        gameFormat: 'team-4v4',
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'group-stage',
        waterfallGraph: TWO_BANDS,
      },
    },
    message: /The Groups line sends 8 on/,
  },
  advanceToBracketNotANumber: {
    breaks: { form: { poolingPhase: 'qual-table', qualAdv: 'abc' } },
    message: /Advance to bracket must be a positive whole number/,
  },
  advanceToBracketBelowFloor: {
    breaks: { form: { poolingPhase: 'qual-table', qualAdv: '3' } },
    message: /Advance to bracket \(3\) is below the minimum of 12/,
  },
  groupExitBelowGroupCount: {
    breaks: { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, groupExit: 'fair-cut', qualAdv: '2' } },
    message: /Advance to bracket \(2\) is below the number of groups/,
  },
  qualRoundsOverrideBad: {
    breaks: { form: { poolingPhase: 'qual-table', qualRoundsOverride: 'x' } },
    message: /Qualification Table round count override must be a whole number/,
  },
  swissRoundsOverrideBad: {
    breaks: {
      count: 13,
      form: { ...ONE_V_ONE, poolingPhase: 'swiss', qualAdv: '4', swissRoundsOverride: 'x' },
    },
    message: /Swiss round count override must be a whole number/,
  },
  nonCountingRoundsNotANumber: {
    breaks: { form: { poolingPhase: 'qual-table', nonCountingRounds: '-1' } },
    message: /Non-counting rounds must be a non-negative whole number/,
  },
  nonCountingRoundsTooMany: {
    breaks: { form: { poolingPhase: 'qual-table', nonCountingRounds: '9' } },
    message: /must leave at least one round that counts/,
  },
  graphBlankWithoutSource: {
    breaks: { form: { scheduleLogic: 'waterfall-bracket' } },
    message: /Custom bracket needs its rounds and routing/,
  },
  pointsTableMissing: {
    breaks: { form: { ...POSITIONAL, positionalPointsTable: '' } },
    message: /needs a rank-to-points table/,
  },
  pointsTableNotNumbers: {
    breaks: { form: { ...POSITIONAL, positionalPointsTable: '10,x' } },
    message: /comma-separated list of non-negative whole numbers/,
  },
  pointsTableRising: {
    breaks: { form: { ...POSITIONAL, positionalPointsTable: '1,2,3,4,5,6,7,8' } },
    message: /must not increase from rank to rank/,
  },
  pointsTableTooShort: {
    breaks: { form: { ...POSITIONAL, positionalPointsTable: '3,2,1' } },
    message: /needs at least 8 entries/,
  },
  matchResultsNotAllowed: {
    breaks: { form: MATCH_RESULTS },
    message: /Match results scoring is only available/,
  },
  matchResultPointsBad: {
    breaks: { count: 13, form: { ...ONE_V_ONE, ...MATCH_RESULTS, qualAdv: '4', matchResultPoints: 'x' } },
    message: /Match result points need four values/,
  },
  tieMarginBad: {
    breaks: { count: 13, form: { ...ONE_V_ONE, ...MATCH_RESULTS, qualAdv: '4', tieMargin: 'x' } },
    message: /Tie margin must be a whole number of points/,
  },
  doubleEliminationNotHeadToHead: {
    breaks: { form: { scheduleLogic: 'double-elimination' } },
    message: /Double elimination isn't available for FFA/,
  },
  doubleEliminationWithFlex: {
    breaks: {
      count: 13,
      form: { ...ONE_V_ONE, scheduleLogic: 'double-elimination', oddCountStrategy: 'flex' },
    },
    message: /doesn't support the "Flex" odd-count strategy/,
  },
  kingsValleyHeadToHead: {
    breaks: { count: 13, form: { ...ONE_V_ONE, scheduleLogic: 'kings-valley' } },
    message: /Kings Valley isn't available for 1v1/,
  },
  kingsValleyTooLarge: {
    breaks: { count: 200, form: { scheduleLogic: 'kings-valley' } },
    message: /Kings Valley can take at most 60 players/,
  },
  noneStrategyCountNotMultiple: {
    breaks: {
      count: 13,
      form: { ...ONE_V_ONE, poolingPhase: 'qual-table', qualAdv: '4', oddCountStrategy: 'none' },
    },
    message: /registered players must be an exact multiple of 2/,
  },
  noneStrategyEntryNotMultiple: {
    breaks: {
      count: 12,
      form: { ...ONE_V_ONE, poolingPhase: 'qual-table', qualAdv: '5', oddCountStrategy: 'none' },
    },
    message: /number advancing to the bracket must be an exact multiple of 2/,
  },
  semisOverrideNegative: {
    breaks: { form: { semisOverride: '-5' } },
    message: /Semis size override must be a positive number/,
  },
  finalOverrideNegative: {
    breaks: { form: { finalOverride: '-5' } },
    message: /Final size override must be a positive number/,
  },
  groupStageEntersTooFewForSemis: {
    breaks: { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, qualifiersPerGroup: '1' } },
    message: /Group stage sends 3 players to the bracket; single elimination needs at least 4/,
  },
  finalOverrideAboveSemisOverride: {
    breaks: { form: { semisOverride: '8', finalOverride: '12' } },
    message: /Final size override \(\d+\) can't exceed the Semis size override/,
  },
  semisOverrideAboveEntrants: {
    breaks: { form: { semisOverride: '50' } },
    message: /Semis size override \(50\) can't exceed the registered count \(37\)/,
  },
  finalOverrideAboveDefaultSemis: {
    breaks: { form: { finalOverride: '30' } },
    message: /can't exceed the default Semis size \(16\)/,
  },
  doubleEliminationTooFewEntrants: {
    breaks: {
      count: 13,
      form: { ...GROUPS_OF_ONE_V_ONE, scheduleLogic: 'double-elimination', qualifiersPerGroup: '1' },
    },
    message: /Can't build a double-elimination bracket — only 3 players/,
  },
  grandFinalTargetNotPositive: {
    breaks: {
      count: 13,
      form: { ...ONE_V_ONE, scheduleLogic: 'double-elimination', grandFinalWbTarget: '-1' },
    },
    message: /Grand Final win targets must be positive/,
  },
  lbQualifiersOutOfRange: {
    breaks: { form: { ...SHARED_FINAL, ...({ lbQualifiers: '0' } as object) } },
    message: /LB qualifiers into the Final \(0\) must be at least 1/,
  },
  winnersQualifiersTooMany: {
    breaks: { form: { ...SHARED_FINAL, poolingPhase: 'qual-table', qualAdv: '16', finalOverride: '30' } },
    message: /needs 28 winners-bracket qualifiers/,
  },
  eliminationTargetsBad: {
    breaks: { form: { eliminationRoundTargets: 'x' } },
    message: /Elimination round targets must be a comma-separated list/,
  },
  seedingOverridesWithoutTargets: {
    breaks: { form: { eliminationSeedingOverrides: 'random' } },
    message: /Elimination seeding overrides require elimination round targets/,
  },
  seedingOverridesWrongCount: {
    breaks: { form: { eliminationRoundTargets: '30,24', eliminationSeedingOverrides: 'random' } },
    message: /must have exactly as many entries as elimination round targets/,
  },
  seedingOverrideUnknownMode: {
    breaks: { form: { eliminationRoundTargets: '30,24', eliminationSeedingOverrides: 'x,y' } },
    message: /Each elimination seeding override must be blank/,
  },
  roomOverTheHardCap: {
    breaks: { count: 200, form: { semisOverride: '190', finalOverride: '100' } },
    message: /over the game's hard cap of 10 players per room/,
  },
  bestOfOverThreeWithMatchResults: {
    breaks: {
      count: 13,
      form: { ...GROUPS_OF_ONE_V_ONE, scoring: 'match-results', tieMargin: '100', poolingBestOf: '5' },
    },
    message: /Match results scoring can't score a Best of 5 group round yet/,
  },
} satisfies Record<string, Check>;

type CheckName = keyof typeof CHECKS;

describe('generateTournament: each check refuses with its own message', () => {
  it.each(Object.entries(CHECKS))('%s', (_name, check: Check) => {
    expect(refusal(check.breaks)).toMatch(check.message);
  });
});

/** What breaks `name`, with more settings on top. */
function plus(name: CheckName, form: Partial<PersistedSetup>): Attempt {
  const { breaks } = CHECKS[name] as Check;
  return { count: breaks.count, form: { ...breaks.form, ...form } };
}

/** Two checks broken at once: the second one's settings win where both set the same field, unless `extra` says. */
function together(first: Check, second: Check, extra: Attempt = {}): Attempt {
  return {
    count: extra.count ?? second.breaks.count ?? first.breaks.count,
    roster: extra.roster ?? second.breaks.roster ?? first.breaks.roster,
    form: { ...first.breaks.form, ...second.breaks.form, ...extra.form },
  };
}

/**
 * Pairs that follow each other in the code. `extra` settles a field both checks set. Where the very next check
 * can't be broken together with the first (see `UNREACHABLE_TOGETHER`), the pair is with the next one that can.
 */
const PAIRS: Array<[CheckName, CheckName, Attempt?]> = [
  ['noRoster', 'unknownFormat'],
  ['unknownFormat', 'rosterOfAnotherFormat'],
  ['rosterOfAnotherFormat', 'belowFloor'],
  ['belowFloor', 'swissNotHeadToHead', { count: 10 }],
  ['groupSizeAboveMaximum', 'qualifiersPerGroupTooMany', { form: { groupSize: '99' } }],
  ['groupSizeAboveMaximum', 'upperLowerPlan', { count: 13, form: { ...GROUPS_OF_ONE_V_ONE } }],
  ['upperLowerPlan', 'qualRoundsOverrideBad'],
  ['graphBlankWithQualSource', 'qualRoundsOverrideBad'],
  [
    'qualifiersPerGroupTooMany',
    'pointsTableMissing',
    { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, scoring: 'positional-points' } },
  ],
  [
    'graphBlankWithGroupsSource',
    'pointsTableMissing',
    { count: 13, form: { ...GROUPS_OF_ONE_V_ONE, scoring: 'positional-points' } },
  ],
  [
    'groupsLineNotShareable',
    'pointsTableMissing',
    plus('groupsLineNotShareable', { scoring: 'positional-points' }),
  ],
  [
    'groupExitBelowGroupCount',
    'pointsTableMissing',
    plus('groupExitBelowGroupCount', { scoring: 'positional-points' }),
  ],
  ['advanceToBracketNotANumber', 'qualRoundsOverrideBad'],
  ['advanceToBracketBelowFloor', 'qualRoundsOverrideBad'],
  ['qualRoundsOverrideBad', 'nonCountingRoundsNotANumber'],
  [
    'swissRoundsOverrideBad',
    'nonCountingRoundsNotANumber',
    plus('swissRoundsOverrideBad', { nonCountingRounds: '-1' }),
  ],
  [
    'nonCountingRoundsNotANumber',
    'graphBlankWithoutSource',
    { count: 13, form: { ...ONE_V_ONE, poolingPhase: 'swiss', qualAdv: '4' } },
  ],
  [
    'nonCountingRoundsTooMany',
    'graphBlankWithoutSource',
    { count: 13, form: { ...ONE_V_ONE, poolingPhase: 'swiss', qualAdv: '4', swissRoundsOverride: '2' } },
  ],
  [
    'graphBlankWithoutSource',
    'pointsTableMissing',
    { count: 13, form: { ...ONE_V_ONE, poolingPhase: 'swiss', qualAdv: '4', scoring: 'positional-points' } },
  ],
  ['pointsTableTooShort', 'doubleEliminationNotHeadToHead'],
  ['matchResultsNotAllowed', 'doubleEliminationNotHeadToHead'],
  ['matchResultPointsBad', 'tieMarginBad'],
  ['tieMarginBad', 'kingsValleyHeadToHead'],
  ['kingsValleyHeadToHead', 'noneStrategyCountNotMultiple'],
  [
    'doubleEliminationNotHeadToHead',
    'grandFinalTargetNotPositive',
    plus('doubleEliminationNotHeadToHead', { gameFormat: 'ffa-individual', grandFinalWbTarget: '-1' }),
  ],
  ['doubleEliminationWithFlex', 'doubleEliminationTooFewEntrants'],
  ['noneStrategyCountNotMultiple', 'noneStrategyEntryNotMultiple', { count: 13, form: { qualAdv: '5' } }],
  ['noneStrategyEntryNotMultiple', 'semisOverrideNegative'],
  ['semisOverrideNegative', 'finalOverrideNegative'],
  ['finalOverrideNegative', 'groupStageEntersTooFewForSemis'],
  [
    'groupStageEntersTooFewForSemis',
    'finalOverrideAboveSemisOverride',
    { count: 13, form: { ...GROUPS_OF_ONE_V_ONE } },
  ],
  [
    'finalOverrideAboveSemisOverride',
    'semisOverrideAboveEntrants',
    { form: { semisOverride: '50', finalOverride: '60' } },
  ],
  ['semisOverrideAboveEntrants', 'eliminationTargetsBad'],
  ['finalOverrideAboveDefaultSemis', 'eliminationTargetsBad'],
  ['doubleEliminationTooFewEntrants', 'grandFinalTargetNotPositive'],
  [
    'lbQualifiersOutOfRange',
    'winnersQualifiersTooMany',
    { form: { poolingPhase: 'qual-table', qualAdv: '16', finalOverride: '30' } },
  ],
  ['lbQualifiersOutOfRange', 'eliminationTargetsBad'],
  ['winnersQualifiersTooMany', 'eliminationTargetsBad'],
  ['eliminationTargetsBad', 'seedingOverridesWrongCount', { form: { eliminationRoundTargets: 'x' } }],
  [
    'seedingOverridesWrongCount',
    'seedingOverrideUnknownMode',
    { form: { eliminationSeedingOverrides: 'x' } },
  ],
  ['seedingOverridesWithoutTargets', 'roomOverTheHardCap'],
  [
    'roomOverTheHardCap',
    'bestOfOverThreeWithMatchResults',
    { count: 200, form: { semisOverride: '90', finalOverride: '60' } },
  ],
];

/*
 * Consecutive checks that no one setup can break together, and why (so the pairs above skip them):
 * - the same field or a field with one value per check: swiss and group stage (`poolingPhase`); the group size
 *   limits; the Advance-to-bracket number; the non-counting rounds; the points table's four checks; the match
 *   results' "not allowed" and its two settings; the Final override and the default Semis (the last needs no
 *   Semis override); the three seeding-override checks that depend on whether targets are set.
 * - a format that is head to head and one that isn't: group stage and its size limits; double elimination and its
 *   Flex check; match results and double elimination's head-to-head check.
 * - branches of one if/else: the Qual-source graph, the Groups-source graph and the plain "Advance to bracket"
 *   checks; the per-group exit refusal (no Groups line) and the group-exit cut (`groupExit` set).
 * - one schedule logic each: double elimination, Kings Valley, shared-Final double elimination, single elimination.
 * - a derived graph: an upper and lower bracket's graph is always valid, so no graph refusal follows its plan.
 * - not reachable at all: the refusal "This game format has no room size" (every format has one, and
 *   `deriveRoomSize` is reached first); the refusal of the progression builder (`catch` after
 *   `buildTournamentProgression`): every setup that would make a builder throw is stopped by an earlier check.
 */
describe('generateTournament: when two consecutive checks both fail, the earlier one is shown', () => {
  it.each(PAIRS)('%s before %s', (first, second, extra) => {
    const attempt = together(CHECKS[first], CHECKS[second], extra);
    const message = refusal(attempt);
    expect(message).toMatch(CHECKS[first].message);
    expect(message).not.toMatch(CHECKS[second].message);
  });
});
