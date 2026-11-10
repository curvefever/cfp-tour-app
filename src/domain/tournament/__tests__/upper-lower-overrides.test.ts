import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { rosterKeys } from '../roster';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { bracketLogicOf } from '../upper-lower';
import { planUpperLowerFor, upperLowerByHand } from '../upper-lower-form';
import { applyUpperLowerFields } from '../upper-lower-replan';
import { finalsMatchOf, serializeWaterfallDraft, waterfallDraftFromRounds } from '../waterfall-draft';
import { applyHandGraphEdit } from '../waterfall-live-edit';
import {
  STRATEGIES,
  expectEveryUnitRankedOnce,
  playDependency,
  playToBracketEntry,
} from './dependency-play-fixtures';
import { rosterFor, testRuntime } from './test-fixtures';

type Setup = Parameters<typeof createDefaultSetup>[0];

/** FFA: "Advance to bracket" 32 asks for everyone who fits (the automatic entry reads the pooling setting, default 24). */
const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table', qualAdv: '32' } as const;
const SWISS = {
  gameFormat: 'individual-1v1',
  poolingPhase: 'swiss',
  oddCountStrategy: 'bye',
  qualAdv: '8',
} as const;
const GROUPS = {
  gameFormat: 'team-4v4',
  poolingPhase: 'group-stage',
  groupSize: '4',
  groupExit: 'fair-cut',
  oddCountStrategy: 'bye',
} as const;

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
  return { ...result.state, started: true };
}

/** The graph "Edit graph" opens on, as the running Admin reads it off the rounds. */
function savedGraphOf(state: TournamentState): string {
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  return serializeWaterfallDraft(
    waterfallDraftFromRounds(state.rounds, {
      rankCount: rosterKeys(state.players).length,
      finalsMatch: finalsMatchOf(finalsGames, finalsBestOf),
    }),
  );
}

/** The text with `from` replaced by `to`, which must be there. */
function replaced(text: string, from: string, to: string): string {
  expect(text, from).toContain(from);
  return text.replace(from, to);
}

const entryOf = (state: TournamentState) => state.cfg.qualAdv;
const bracketNames = (state: TournamentState) =>
  state.rounds.filter((round) => round.isWaterfall).map((round) => round.customLabel);

/** Played on to the Final in the five press orders, every unit once in Rankings after every press. */
function expectPlaysToTheFinalRankedOnce(state: TournamentState): void {
  const count = rosterKeys(state.players).length;
  const entered = playToBracketEntry(state);
  for (const strategy of Object.values(STRATEGIES)) {
    const played = playDependency(entered, strategy, (current) => {
      expectEveryUnitRankedOnce(current, count);
      return current;
    });
    expectEveryUnitRankedOnce(played, count);
  }
}

function expectHandEdit(state: TournamentState, text: string): TournamentState {
  const edited = applyHandGraphEdit(state, text);
  if (!edited.ok) throw new Error(edited.error);
  expect(bracketLogicOf(edited.state)).toBe('waterfall-bracket');
  expect(edited.state.gamemodeConfig.upperLowerVersion).toBeUndefined();
  expectPlaysToTheFinalRankedOnce(edited.state);
  return edited.state;
}

const LOWER_A = 'Round 5 - Lower.A: 1-4->Round 6 - Lower, 5-8->Round 6 - Ranking';
const LOWER_B = 'Round 5 - Lower.B: 1-4->Round 6 - Lower, 5-8->Round 6 - Ranking';
const NARROWED_A = 'Round 5 - Lower.A: 1-4->Round 6 - Lower, 5-7->Round 6 - Ranking';
const NARROWED_B = 'Round 5 - Lower.B: 1-4->Round 6 - Lower, 5-7->Round 6 - Ranking';

describe('"Edit graph" on the built-in bracket at 31, the bracket entered', () => {
  const entered = () => playToBracketEntry(built(31, QUAL));

  it('a resized undrawn round with its feeders routes changed', () => {
    const state = entered();
    let text = savedGraphOf(state);
    text = replaced(text, 'Round 6 - Ranking = 8 RANKING', 'Round 6 - Ranking = 6 RANKING');
    text = replaced(text, LOWER_A, NARROWED_A);
    text = replaced(text, LOWER_B, NARROWED_B);
    const edited = expectHandEdit(state, text);
    expect(edited.rounds.find((round) => round.customLabel === 'Round 6 - Ranking')?.rooms).toEqual([6]);
  });

  it('a changed number going on from a round in play', () => {
    const state = entered();
    expect(state.rounds[state.curRound].customLabel).toBe('Round 4 - Upper');
    let text = savedGraphOf(state);
    text = replaced(
      text,
      'Round 4 - Lower.A: 1-4->Round 5 - Lower, 5-8->Round 5 - Ranking',
      'Round 4 - Lower.A: 1-3->Round 5 - Lower, 4-8->Round 5 - Ranking',
    );
    text = replaced(
      text,
      'Round 4 - Lower.B: 1-4->Round 5 - Lower, 5-7->Round 5 - Ranking',
      'Round 4 - Lower.B: 1-5->Round 5 - Lower, 6-7->Round 5 - Ranking',
    );
    expectHandEdit(state, text);
  });

  it('a reached round resized is refused, and the bracket stays the built-in one', () => {
    const state = entered();
    let text = replaced(savedGraphOf(state), 'Round 4 - Upper = 2x8', 'Round 4 - Upper = 2x7');
    for (const room of ['A', 'B']) {
      text = replaced(
        text,
        `Round 4 - Upper.${room}: 1-4->Semi-Final A, 5-8->Round 5 - Lower`,
        `Round 4 - Upper.${room}: 1-4->Semi-Final A, 5-7->Round 5 - Lower`,
      );
    }
    const edited = applyHandGraphEdit(state, text);
    expect(edited.ok).toBe(false);
    if (!edited.ok) expect(edited.error).toMatch(/Round 4 - Upper/);
    expect(bracketLogicOf(state)).toBe('upper-lower');
  });
});

describe('"Edit graph" while qualifying', () => {
  it('a change of the Qual ranks: 15 start in the upper rooms, 16 in the lower', () => {
    const state = built(31, QUAL);
    const text = replaced(
      savedGraphOf(state),
      'Qual: 1-16->Round 4 - Upper, 17-31->Round 4 - Lower',
      'Qual: 1-15->Round 4 - Upper, 16-31->Round 4 - Lower',
    );
    const edited = expectHandEdit(state, text);
    expect(edited.rounds.find((round) => round.standingsRoutes)?.standingsRoutes).toHaveLength(31);
  });
});

describe('a live change of the two numbers in a Swiss and in a group stage', () => {
  it('Swiss 9: Advance to bracket from 8 to 4, the rooms are those of a fresh generation with 4', () => {
    const state = built(9, SWISS);
    expect(entryOf(state)).toBe(8);
    const saved = applyUpperLowerFields(state, { advance: '4', upper: '' });
    if (!saved.ok) throw new Error(saved.message);
    const fresh = built(9, { ...SWISS, upperLowerAdvance: '4' });
    expect(entryOf(saved.state)).toBe(4);
    expect(saved.state.rounds.map((round) => round.rooms)).toEqual(fresh.rounds.map((round) => round.rooms));
    expect(bracketNames(saved.state)).toEqual(bracketNames(fresh));
    expect(bracketLogicOf(saved.state)).toBe('upper-lower');
    expectPlaysToTheFinalRankedOnce(saved.state);
  });

  it('group stage 13 teams: Advance to bracket from 8 to 4', () => {
    const state = built(13, GROUPS);
    expect(entryOf(state)).toBe(8);
    const saved = applyUpperLowerFields(state, { advance: '4', upper: '' });
    if (!saved.ok) throw new Error(saved.message);
    const fresh = built(13, { ...GROUPS, upperLowerAdvance: '4' });
    expect(entryOf(saved.state)).toBe(4);
    expect(saved.state.rounds.map((round) => round.rooms)).toEqual(fresh.rounds.map((round) => round.rooms));
    expect(saved.state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes).toHaveLength(4);
    expectPlaysToTheFinalRankedOnce(saved.state);
  });
});

describe('Upper rooms and Advance to bracket after a Swiss and after a group stage', () => {
  it('Swiss, 8 entering: 4 upper is accepted, 3 and 5 are refused (each room holds 2)', () => {
    expect(generate(9, { ...SWISS, upperLowerUpper: '4' }).status).toBe('generated');
    for (const typed of ['3', '5']) {
      expect(generate(9, { ...SWISS, upperLowerUpper: typed })).toEqual({
        status: 'invalid',
        message: `Upper rooms (${typed}) can't be seated: with 8 entering, use 4.`,
      });
    }
  });

  it.each([
    ['1v1 Swiss', SWISS, [9, 16]],
    ['4v4 groups', GROUPS, [11, 16]],
  ] as const)('%s: Advance to bracket 4 and 8', (_label, setup, counts) => {
    for (const count of counts) {
      for (const advance of [4, 8]) {
        const state = built(count, { ...setup, upperLowerAdvance: String(advance) });
        expect(entryOf(state), `${count} / ${advance}`).toBe(advance);
        expectPlaysToTheFinalRankedOnce(state);
      }
    }
  });

  it('a per-group exit at 3 groups is refused in the words of the groups', () => {
    expect(generate(11, { ...GROUPS, groupExit: 'per-group' })).toEqual({
      status: 'invalid',
      message:
        '2 per group from 3 groups gives 6 teams: an upper and lower bracket takes 4 or 8. Choose Even split or Fair cut with 4 or 8, or type Advance to bracket.',
    });
  });
});

describe('"Adjust rounds by hand", then edited, and the option chosen again', () => {
  const handText = (count: number, setup: Setup) => {
    const text = upperLowerByHand(createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup }), count);
    if (!text.ok) throw new Error(text.message);
    return text.text;
  };
  const asCustom = (count: number, setup: Setup, text: string) =>
    generate(count, { ...setup, scheduleLogic: 'waterfall-bracket', waterfallGraph: text });

  it('a changed route generates, and so does a resized room', () => {
    const text = handText(31, QUAL);
    const rerouted = replaced(
      replaced(text, LOWER_A, 'Round 5 - Lower.A: 1-4->Round 6 - Ranking, 5-8->Round 6 - Lower'),
      LOWER_B,
      'Round 5 - Lower.B: 1-4->Round 6 - Ranking, 5-8->Round 6 - Lower',
    );
    expect(asCustom(31, QUAL, rerouted).status).toBe('generated');
    const resized = replaced(text, 'Round 6 - Ranking = 8 RANKING', 'Round 6 - Ranking = 6 RANKING');
    const narrowed = replaced(replaced(resized, LOWER_A, NARROWED_A), LOWER_B, NARROWED_B);
    expect(asCustom(31, QUAL, narrowed).status).toBe('generated');
  });

  it('1v1 Swiss 9: the text keeps its Qual line and generates as a Custom bracket', () => {
    const text = handText(9, SWISS);
    expect(text).toContain('Qual:');
    expect(asCustom(9, SWISS, text).status).toBe('generated');
  });

  it('choosing "Upper and lower bracket" again works the rooms out and ignores the graph field', () => {
    const edited = replaced(
      handText(31, QUAL),
      LOWER_A,
      'Round 5 - Lower.A: 1-4->Round 6 - Ranking, 5-8->Round 6 - Lower',
    );
    const again = built(31, { ...QUAL, waterfallGraph: edited });
    const fresh = built(31, QUAL);
    expect(again.gamemodeConfig.upperLowerVersion).toBe(1);
    expect(again.rounds.map((round) => [round.customLabel, round.rooms, round.waterfallRoutes])).toEqual(
      fresh.rounds.map((round) => [round.customLabel, round.rooms, round.waterfallRoutes]),
    );
  });
});

describe('the automatic entry follows the pooling setting', () => {
  /** FFA qualification table: the default "Advance to bracket" is 24 (no upper and lower field typed). */
  const FFA = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;
  const entering = (count: number, setup: Setup) => {
    const result = generate(count, setup);
    // The units entering are the ranks the pooling line routes (a per-group exit leaves `cfg.qualAdv` at the head count).
    return result.status === 'generated'
      ? result.state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes?.length
      : result.message;
  };

  it('FFA with the default Advance to bracket 24: 24 enter at 29, 31, 37, 43 and 53', () => {
    expect([29, 31, 37, 43, 53].map((count) => entering(count, FFA))).toEqual([24, 24, 24, 24, 24]);
  });

  it('FFA with Advance to bracket 32: everyone who fits, up to 32', () => {
    const setup = { ...FFA, qualAdv: '32' };
    expect([29, 31, 37, 43, 53].map((count) => entering(count, setup))).toEqual([29, 31, 32, 32, 32]);
  });

  it('FFA with Advance to bracket 20: refused, naming 16 or 24', () => {
    for (const count of [29, 37, 53]) {
      expect(entering(count, { ...FFA, qualAdv: '20' }), `${count}`).toBe(
        'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
      );
    }
  });

  it('a typed upper and lower field still wins over the pooling setting', () => {
    expect(entering(37, { ...FFA, qualAdv: '20', upperLowerAdvance: '28' })).toBe(28);
    expect(entering(37, { ...FFA, upperLowerAdvance: '99' })).toBe(32);
  });

  it('1v1 Swiss at 9 and 16: 8 enter by default (24 asks for everyone), and Advance to bracket 4 gives 4', () => {
    const swiss = { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye' } as const;
    expect([9, 16].map((count) => entering(count, swiss))).toEqual([8, 8]);
    expect([9, 16].map((count) => entering(count, { ...swiss, qualAdv: '4' }))).toEqual([4, 4]);
    expect(entering(16, { ...swiss, qualAdv: '6' })).toBe(
      'Advance to bracket (6) has no upper and lower bracket: use 4 or 8.',
    );
  });

  describe('after a group stage', () => {
    const perGroup = { ...GROUPS, groupExit: 'per-group' } as const;

    it('so many per group: 8 teams in 2 groups of 4 send 2 each (4), 16 in 4 groups send 8', () => {
      expect(entering(8, perGroup)).toBe(4);
      expect(entering(16, perGroup)).toBe(8);
    });

    it('3 groups of 2 each is 6 teams: refused in the words of the groups, with the options', () => {
      expect(entering(12, perGroup)).toBe(
        '2 per group from 3 groups gives 6 teams: an upper and lower bracket takes 4 or 8. Choose Even split or Fair cut with 4 or 8, or type Advance to bracket.',
      );
    });

    it('qualifiers per group is the automatic source: 1 per group from 4 groups gives 4', () => {
      expect(entering(16, { ...perGroup, qualifiersPerGroup: '1' })).toBe(4);
    });

    it('a fair cut or an even split takes its total, the Advance to bracket total: 8 at 12', () => {
      expect(entering(12, { ...GROUPS, groupExit: 'fair-cut', qualAdv: '8' })).toBe(8);
      expect(entering(12, { ...GROUPS, groupExit: 'even-split', qualAdv: '8' })).toBe(8);
      expect(entering(12, { ...GROUPS, groupExit: 'fair-cut', qualAdv: '6' })).toBe(
        'Advance to bracket (6) has no upper and lower bracket: use 4 or 8.',
      );
    });
  });

  it('a withdrawal during pooling at 29 → 28 keeps 24 entering; a typed field of the running Admin is read first', () => {
    const state = built(29, FFA);
    expect(entryOf(state)).toBe(24);
    const removed = removeRosterUnit(state, rosterKeys(state.players)[0]);
    expect(entryOf(removed)).toBe(24);
    expect(entryOf(removeRosterUnit(removed, rosterKeys(removed.players)[0]))).toBe(24);
  });

  it('the re-work reads the same rule: Advance to bracket 32 grows with a joiner, 24 does not', () => {
    const wide = built(30, { ...FFA, qualAdv: '32' });
    expect(entryOf(wide)).toBe(30);
    expect(entryOf(removeRosterUnit(wide, rosterKeys(wide.players)[0]))).toBe(29);
    const narrow = built(30, FFA);
    expect(entryOf(removeRosterUnit(narrow, rosterKeys(narrow.players)[0]))).toBe(24);
  });

  it.each([
    ['FFA 29, default', 29, FFA],
    ['FFA 37, 20', 37, { ...FFA, qualAdv: '20' }],
    [
      'Swiss 16, 6',
      16,
      { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye', qualAdv: '6' },
    ],
    ['groups 12, per group', 12, { ...GROUPS, groupExit: 'per-group' }],
    ['groups 16, per group', 16, { ...GROUPS, groupExit: 'per-group' }],
    ['groups 12, fair cut 8', 12, { ...GROUPS, groupExit: 'fair-cut', qualAdv: '8' }],
  ] as const)('the Setup panel is ready exactly when generation generates: %s', (_label, count, setup) => {
    const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
    const planned = planUpperLowerFor(form, count);
    const generated = generate(count, setup);
    expect(planned.ok).toBe(generated.status === 'generated');
    if (!planned.ok && generated.status === 'invalid') expect(planned.message).toBe(generated.message);
  });
});
