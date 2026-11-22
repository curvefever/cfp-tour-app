import { describe, expect, it } from 'vitest';
import { removeRosterUnit } from '../mutations';
import { generateTournament } from '../generation';
import { deriveRoomSize, getGameFormat } from '../formats';
import { roomMatch } from '../match-format';
import { rosterKeys } from '../roster';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { applyStageMatchEdit, stageMatchScope, UNEVEN_FINAL_REASON } from '../stage-match-edit';
import { applyTournamentSettings, settingsFromForm } from '../tournament-settings';
import type { TournamentState } from '../types';
import { upperLowerByHand } from '../upper-lower-form';
import { planUpperLower, upperLowerGraphText } from '../upper-lower';
import { upperLowerFinalWins } from '../upper-lower-wins';
import { applyHandGraphEdit } from '../waterfall-live-edit';
import { indexOf, playColumns } from './dependency-play-fixtures';
import { generatedState, rosterFor, testRuntime } from './test-fixtures';
import { atEntry } from './swiss-source-fixtures';
import { withoutDependencyPlay } from './qual-waterfall';
import { roomFinishOrder } from '../advancement';

type Setup = Parameters<typeof createDefaultSetup>[0];

const SWISS = {
  gameFormat: 'individual-1v1',
  poolingPhase: 'swiss',
  oddCountStrategy: 'bye',
  qualAdv: '8',
} as const;
const UNEVEN = { finalsUnevenWins: 'yes' } as const;

function built(count: number, setup: Setup): TournamentState {
  const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
  return generatedState(
    generateTournament(
      createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
      form,
      testRuntime(),
    ),
  );
}

const finalOf = (state: TournamentState) => state.rounds[state.rounds.findIndex((round) => round.isFinal)];
const targetsOf = (state: TournamentState) => finalOf(state).winTargets?.map((target) => target.wins);

describe('the upper and lower bracket Final with uneven wins', () => {
  it.each([
    [9, 8],
    [13, 8],
    [16, 8],
    [5, 4],
  ])('writes WINS on the Final with the defaults at %i units (%i enter)', (count, entering) => {
    const state = built(count, { ...SWISS, ...UNEVEN, qualAdv: String(entering) });
    expect(targetsOf(state)).toEqual([1, 2]);
    expect(finalOf(state).numGames).toBe(2);
    expect(finalOf(state).bestOf).toBeUndefined();
  });

  it.each([
    [9, 8],
    [13, 8],
    [16, 8],
    [5, 4],
  ])('takes the typed numbers at %i units (%i enter)', (count, entering) => {
    const state = built(count, {
      ...SWISS,
      ...UNEVEN,
      qualAdv: String(entering),
      finalsUpperWins: '2',
      finalsLowerWins: '3',
    });
    expect(targetsOf(state)).toEqual([2, 3]);
    expect(finalOf(state).numGames).toBe(4);
  });

  it('gives the upper source the upper number and the lower source the lower one, in both shapes', () => {
    for (const [count, upper, lower] of [
      [5, 'Round 4 - Upper', 'Semi-Final'],
      [13, 'Semi-Final A', 'Semi-Final B'],
    ] as const) {
      const state = built(count, {
        ...SWISS,
        ...UNEVEN,
        qualAdv: count === 5 ? '4' : '8',
        finalsUpperWins: '3',
        finalsLowerWins: '1',
      });
      const targets = finalOf(state).winTargets ?? [];
      const byRound = (label: string) =>
        targets.find((target) => target.from === indexOf(state, label))?.wins;
      expect([byRound(upper), byRound(lower)], `${count} units`).toEqual([3, 1]);
    }
  });

  it('plays the Final as the Finals format when the option is off', () => {
    const state = built(13, { ...SWISS, finalsGames: '3', qualAdv: '8' });
    expect(finalOf(state).winTargets).toBeUndefined();
    expect(finalOf(state).numGames).toBe(3);
  });

  it('leaves the Finals Best of fields as they were underneath', () => {
    const state = built(13, { ...SWISS, ...UNEVEN, finalsBestOf: '5', finalsGames: '3', qualAdv: '8' });
    expect(state.settings?.finalsBestOf).toBe('5');
    expect(targetsOf(state)).toEqual([1, 2]);
    const off = built(13, { ...SWISS, finalsBestOf: '5', finalsGames: '3', qualAdv: '8' });
    expect(finalOf(off).bestOf).toBe(5);
  });

  it('refuses a number outside 1 to 9, naming the box', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'upper-lower',
      ...SWISS,
      ...UNEVEN,
      finalsUpperWins: '12',
    });
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 13, players: rosterFor(form.gameFormat, 13) }),
      form,
      testRuntime(),
    );
    expect(result).toMatchObject({
      status: 'invalid',
      message: 'Upper finalist needs must be a whole number from 1 to 9 — got "12".',
    });
    const lower = upperLowerFinalWins(
      { finalsUnevenWins: 'yes', finalsLowerWins: 'x' },
      deriveRoomSize(getGameFormat('individual-1v1') as never),
    );
    expect(lower).toEqual({
      ok: false,
      message: 'Lower finalist needs must be a whole number from 1 to 9 — got "x".',
    });
  });

  it.each([31, 37])(
    'is not offered in FFA (%i): the derived text has no WINS and the Final plays its format',
    (count) => {
      const form = createDefaultSetup({
        scheduleLogic: 'upper-lower',
        gameFormat: 'ffa-individual',
        poolingPhase: 'qual-table',
        qualAdv: '32',
        ...UNEVEN,
        finalsUpperWins: '2',
      });
      const roomSize = deriveRoomSize(getGameFormat('ffa-individual') as never);
      const plan = planUpperLower(form, count, roomSize, 'players');
      expect(plan.ok && plan.finalWins).toBeNull();
      const byHand = upperLowerByHand(form, count);
      expect(byHand.ok && byHand.text).not.toContain('WINS');
      const state = built(count, {
        gameFormat: 'ffa-individual',
        poolingPhase: 'qual-table',
        qualAdv: '32',
        ...UNEVEN,
      });
      expect(finalOf(state).winTargets).toBeUndefined();
    },
  );

  it('is not offered in a multi-team format either (the Final holds more than two)', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'upper-lower',
      gameFormat: 'team-2v2v2',
      poolingPhase: 'qual-table',
      ...UNEVEN,
    });
    const roomSize = deriveRoomSize(getGameFormat('team-2v2v2') as never);
    expect(upperLowerFinalWins(form, roomSize)).toEqual({ ok: true, wins: null });
  });

  it('writes the numbers into the text "Adjust rounds by hand" hands over', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'upper-lower',
      ...SWISS,
      ...UNEVEN,
      finalsUpperWins: '2',
      finalsLowerWins: '3',
    });
    const text = upperLowerByHand(form, 13);
    expect(text.ok && text.text).toContain('Final = 2 FINAL WINS');
    expect(text.ok && text.text).toContain('Semi-Final A: 1->Final WINS 2, 2->Semi-Final B');
    expect(text.ok && text.text).toContain('Semi-Final B: 1->Final WINS 3');
    const small = upperLowerByHand(form, 5);
    expect(small.ok && small.text).toContain('Round 4 - Upper: 1->Final WINS 2, 2->Semi-Final');
    expect(small.ok && small.text).toContain('Semi-Final: 1->Final WINS 3');
  });

  it('keeps the numbers when a removal works the rooms out again, and when the Setup settings are copied', () => {
    const state = built(13, {
      ...SWISS,
      ...UNEVEN,
      finalsUpperWins: '2',
      finalsLowerWins: '3',
      qualAdv: '8',
    });
    const names = rosterKeys(state.players);
    const after = removeRosterUnit({ ...state, started: true }, names[names.length - 1]);
    expect(targetsOf(after)).toEqual([2, 3]);
    const settings = settingsFromForm(
      createDefaultSetup({ ...SWISS, ...UNEVEN, finalsUpperWins: '2', finalsLowerWins: '3' }),
    );
    const copied = applyTournamentSettings(createDefaultSetup(), settings);
    expect([copied.finalsUnevenWins, copied.finalsUpperWins, copied.finalsLowerWins]).toEqual([
      'yes',
      '2',
      '3',
    ]);
  });

  it('is no stage: the live Match format panel locks the Final with the reason, and a save of its stage is refused', () => {
    const state = { ...built(13, { ...SWISS, ...UNEVEN, qualAdv: '8' }), started: true };
    const scope = stageMatchScope(state);
    expect(scope.kind).toBe('stages');
    if (scope.kind !== 'stages') return;
    const finals = scope.stages.find((entry) => entry.stage === 'finals');
    expect(finals).toMatchObject({ locked: true, lockedReason: UNEVEN_FINAL_REASON });
    expect(scope.rounds.some((entry) => entry.stage === 'finals')).toBe(false);
    const saved = applyStageMatchEdit(state, { finals: { games: 3, bestOf: 5 } });
    expect(saved.ok).toBe(false);
  });

  it('plays to the Final with the upper finalist stamped with the upper number', () => {
    const state = withoutDependencyPlay({
      ...built(13, { ...SWISS, ...UNEVEN, finalsUpperWins: '2', finalsLowerWins: '3', qualAdv: '8' }),
      started: true,
    });
    const final = playColumns(atEntry(state));
    const index = final.rounds.findIndex((round) => round.isFinal);
    const upper = roomFinishOrder(final, indexOf(final, 'Semi-Final A'), 1)[0];
    const lower = roomFinishOrder(final, indexOf(final, 'Semi-Final B'), 1)[0];
    expect(
      Object.fromEntries(final.assignments[index].map((entry) => [entry.name, entry.winsNeeded])),
    ).toEqual({
      [upper]: 2,
      [lower]: 3,
    });
    expect(
      roomMatch(final, index, 1)
        ?.units.map((unit) => unit.needed)
        .sort(),
    ).toEqual([2, 3]);
  });

  it('the by-hand graph text round-trips through a hand edit of the running tournament', () => {
    const state = built(13, {
      ...SWISS,
      ...UNEVEN,
      finalsUpperWins: '2',
      finalsLowerWins: '3',
      qualAdv: '8',
    });
    const form = createDefaultSetup({
      scheduleLogic: 'upper-lower',
      ...SWISS,
      ...UNEVEN,
      finalsUpperWins: '2',
      finalsLowerWins: '3',
    });
    const text = upperLowerByHand(form, 13);
    if (!text.ok) throw new Error(text.message);
    const edited = applyHandGraphEdit({ ...state, started: true }, text.text);
    expect(edited.ok ? targetsOf(edited.state) : edited).toEqual([2, 3]);
  });

  it('keeps the derived text without uneven wins as it was', () => {
    expect(upperLowerGraphText(8, deriveRoomSize(getGameFormat('individual-1v1') as never), 6)).not.toContain(
      'WINS',
    );
  });
});
