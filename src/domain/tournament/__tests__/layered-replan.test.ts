import { describe, expect, it } from 'vitest';
import { bracketLogicOf } from '../app-written-bracket';
import {
  checkLayeredPlan,
  keepLayeredPlan,
  differsOnlyInFirstLowerRooms,
  layeredPlayNow,
  acceptLayeredPlan,
  type LayeredPlanCheck,
} from '../layered-replan';
import { planLayeredFor, planLayeredForUncached, type LayeredForm } from '../layered-form';
import { addWalkUpIndividual, removeRosterUnit } from '../mutations';
import { layeredKeptPlayOf, layeredPlayOf } from '../rule-versions';
import { MISSING_ROOM_SIZE_MESSAGE } from '../round-advance-tools';
import type { TournamentState } from '../types';
import { applyHandGraphEdit } from '../waterfall-live-edit';
import { finalsMatchOf, serializeWaterfallDraft, waterfallDraftFromRounds } from '../waterfall-draft';
import { expectPlaysToTheFinal, playToBracketEntry } from './dependency-play-fixtures';
import {
  FFA_QUAL,
  FIRST_ROUND,
  afterFiveAbsent,
  afterSevenJoined,
  afterThreeAbsent,
  built,
  planFor,
  playRound,
  plannedRounds,
  players,
  roomsOf,
} from './layered-test-support';

/**
 * A layered bracket planned again while the table runs: 31 registered, 28 expected. The number who play now is the
 * roster less the players absent from their last round and not back; the card shows when the app's plan for it differs
 * from the plan in use.
 */

function newOf(check: LayeredPlanCheck) {
  if (check.kind !== 'new') throw new Error(`expected a new plan, got ${check.kind}`);
  return check;
}

const bracketRooms = (state: TournamentState) =>
  state.rounds.filter((round) => round.isWaterfall).map((round) => [round.customLabel, round.rooms]);

describe('the number who play now', () => {
  it('is the number expected before the first table round is sent on: 28 of 31, or the typed number', () => {
    expect(layeredPlayNow(built(31))).toBe(28);
    expect(layeredPlayNow(built(31, { ...FFA_QUAL, layeredExpected: '26' }))).toBe(26);
  });

  it('is the roster less those absent from their last round and not back', () => {
    const state = afterThreeAbsent();
    expect(layeredPlayNow(state)).toBe(28);
    expect(layeredPlayNow(afterFiveAbsent())).toBe(26);
  });

  it('counts a unit back again once it is marked back or plays, and takes a removal off the roster', () => {
    const state = afterFiveAbsent();
    const [first] = players(state);
    const removed = removeRosterUnit(state, first);
    expect(layeredPlayNow(removed)).toBe(30 - 4);
  });
});

describe('the answer at the number the plan was made for or kept at needs no planning', () => {
  /** A state whose graph edit refuses: planning and saving would say so, so an answer without it is a shortcut. */
  const withoutFinalsGames = (state: TournamentState): TournamentState => {
    const { finalsGames: _games, ...config } = state.gamemodeConfig;
    return { ...state, gamemodeConfig: config };
  };

  it('is current when the number who play now is the number the plan was made for, without a graph edit', () => {
    expect(checkLayeredPlan(withoutFinalsGames(built(31)))).toEqual({ kind: 'current', playNow: 28 });
    expect(checkLayeredPlan(withoutFinalsGames(afterThreeAbsent()))).toEqual({
      kind: 'current',
      playNow: 28,
    });
  });

  it('plans, and so meets the refusal, at any other number', () => {
    expect(checkLayeredPlan(withoutFinalsGames(afterFiveAbsent())).kind).toBe('refused');
  });

  it('is kept when the number who play now is the number it was kept at, without a graph edit', () => {
    const kept = keepLayeredPlan(afterFiveAbsent());
    expect(checkLayeredPlan(withoutFinalsGames(kept))).toEqual({ kind: 'kept', playNow: 26 });
  });

  it('does not take the shortcut for the typed numbers of the card', () => {
    expect(checkLayeredPlan(withoutFinalsGames(built(31)), { layeredRounds: '5' }).kind).toBe('refused');
  });
});

describe('a new plan while the table runs', () => {
  it('31 registered, 28 expected: nothing before the first table round, nothing with three absent (28 play)', () => {
    expect(checkLayeredPlan(built(31))).toEqual({ kind: 'current', playNow: 28 });
    expect(checkLayeredPlan(afterThreeAbsent())).toEqual({ kind: 'current', playNow: 28 });
  });

  it('two more absent (26 play): no card, the plan would only move the first Lower rooms (8+7 to 7+7)', () => {
    expect(checkLayeredPlan(afterFiveAbsent())).toEqual({ kind: 'current', playNow: 26 });
  });

  it('seven late joiners (35 play): a card, 29 in the bracket in place of 23, one Upper room becomes two', () => {
    const check = newOf(checkLayeredPlan(afterSevenJoined()));
    expect(check.playNow).toBe(35);
    expect(check.next.inBracket.value).toBe(29);
    expect(check.next.play).toEqual({ value: 35, setBy: 'organiser', reason: '' });
    expect(check.next.levels).toEqual([
      { name: 'Upper', players: 16 },
      { name: 'Lower', players: 13 },
    ]);
    expect(check.next.rounds[0].levels.map((level) => [level.level, level.rooms])).toEqual([
      ['Upper', [8, 8]],
      ['Lower', [7, 6]],
    ]);
    expect(check.inUse?.inBracket.value).toBe(23);
    expect(check.inUse?.play.value).toBe(28);
    expect(check.firstRound).toBe(FIRST_ROUND);
  });

  it('a typed number in the card at a first-Lower-rooms difference: the card shows the new plan', () => {
    const state = afterFiveAbsent();
    expect(checkLayeredPlan(state).kind).toBe('current');
    const check = newOf(checkLayeredPlan(state, { layeredRounds: '5' }));
    expect(check.next.inBracket.value).toBe(22);
    expect(check.next.bracketRounds.setBy).toBe('organiser');
  });

  it('the plan in use is the one the tournament was generated with', () => {
    const generated = built(31);
    expect(layeredPlayOf(generated)).toBe(28);
    expect(newOf(checkLayeredPlan(afterSevenJoined())).inUse?.levels).toEqual([
      { name: 'Upper', players: 8 },
      { name: 'Lower', players: 15 },
    ]);
  });

  it('typed numbers stay as typed; only "Expected to play" becomes the number who play now', () => {
    const state = afterSevenJoined({ ...FFA_QUAL, layeredLevels: '2', layeredExpected: '30' });
    const check = newOf(checkLayeredPlan(state));
    expect(check.next.levelCount).toEqual({ value: 2, setBy: 'organiser', reason: '' });
    expect(check.next.play.value).toBe(35);
    expect(check.inUse?.play.value).toBe(30);
  });

  it('a typed size that does not depend on the number who play keeps the plan: no card', () => {
    const state = afterFiveAbsent({ ...FFA_QUAL, layeredInBracket: '20' });
    expect(checkLayeredPlan(state).kind).toBe('current');
  });

  it('is nothing for a tournament that is not a layered bracket', () => {
    const custom = built(31);
    const handEdited = applyHandGraphEdit(
      custom,
      serializeWaterfallDraft(
        waterfallDraftFromRounds(custom.rounds, {
          rankCount: 31,
          finalsMatch: finalsMatchOf(custom.gamemodeConfig.finalsGames, custom.gamemodeConfig.finalsBestOf),
        }),
      ),
    );
    if (!handEdited.ok) throw new Error(handEdited.error);
    expect(bracketLogicOf(handEdited.state)).toBe('waterfall-bracket');
    expect(checkLayeredPlan(handEdited.state)).toEqual({ kind: 'none' });
  });

  it('a hand edit ends it after the card has shown', () => {
    const state = afterSevenJoined();
    expect(checkLayeredPlan(state).kind).toBe('new');
    const handEdited = applyHandGraphEdit(
      state,
      serializeWaterfallDraft(
        waterfallDraftFromRounds(state.rounds, {
          rankCount: 31,
          finalsMatch: finalsMatchOf(state.gamemodeConfig.finalsGames, state.gamemodeConfig.finalsBestOf),
        }),
      ),
    );
    if (!handEdited.ok) throw new Error(handEdited.error);
    expect(checkLayeredPlan(handEdited.state)).toEqual({ kind: 'none' });
    expect(acceptLayeredPlan(handEdited.state)).toMatchObject({ ok: false });
  });

  it('is nothing once the first bracket round is drawn, and "Use the new plan" is refused', () => {
    const entered = playToBracketEntry(built(31));
    expect(checkLayeredPlan(entered)).toEqual({ kind: 'none' });
    expect(acceptLayeredPlan(entered)).toMatchObject({ ok: false });
  });

  it('is refused in the words of a missing room size when the stored state has none', () => {
    const state = afterFiveAbsent();
    const { roomSize: _roomSize, ...config } = state.gamemodeConfig;
    expect(checkLayeredPlan({ ...state, gamemodeConfig: config })).toEqual({
      kind: 'refused',
      message: MISSING_ROOM_SIZE_MESSAGE,
    });
  });

  it('says why when the number who play now has no plan, and leaves the plan in use', () => {
    const state = afterFiveAbsent();
    const check = checkLayeredPlan({
      ...state,
      settings: state.settings && { ...state.settings, layeredLevels: '3', layeredInBracket: '20' },
    });
    expect(check).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('No layered bracket seats'),
    });
  });
});

describe('"Use the new plan"', () => {
  it('saves the plan for 35: the rooms of a fresh plan at 35, the pooling rounds, scores and tie picks kept, the mark kept', () => {
    const state = afterSevenJoined();
    const result = acceptLayeredPlan(state);
    if (!result.ok) throw new Error(result.message);
    const next = result.state;
    const fresh = built(38, { ...FFA_QUAL, layeredExpected: '35' });
    expect(bracketRooms(next)).toEqual(bracketRooms(fresh));
    expect(next.cfg.qualAdv).toBe(29);
    expect(next.scores).toEqual(state.scores);
    expect(next.tieResolutions).toEqual(state.tieResolutions);
    // The last table round carries the routing of the standings, which follows the new plan.
    const pooling = (rounds: TournamentState['rounds']) =>
      rounds.slice(0, FIRST_ROUND - 1).map(({ standingsRoutes: _routes, ...round }) => round);
    expect(pooling(next.rounds)).toEqual(pooling(state.rounds));
    expect(next.curRound).toBe(state.curRound);
    expect(bracketLogicOf(next)).toBe('layered');
    expect(layeredPlayOf(next)).toBe(35);
    expect(next.settings).toEqual(state.settings);
  });

  it('marks the stages again and keeps the match formats', () => {
    const state = afterFiveAbsent({ ...FFA_QUAL, semisBestOf: '3', bracketGames: '2' });
    const result = acceptLayeredPlan(state);
    if (!result.ok) throw new Error(result.message);
    const stages = Object.fromEntries(
      result.state.rounds
        .filter((round) => round.isWaterfall)
        .map((round) => [round.customLabel, round.graphMatchStage]),
    );
    expect(stages['Semi-Final A']).toBe('semis');
    expect(stages.Final).toBe('finals');
    expect(Object.values(stages).filter((stage) => stage === 'bracket').length).toBeGreaterThan(0);
    const semi = result.state.rounds.find((round) => round.customLabel === 'Semi-Final B');
    expect(semi?.bestOf).toBe(3);
  });

  it("then plays to the Final, with every round drawn at the new plan's size", () => {
    const result = acceptLayeredPlan(afterSevenJoined());
    if (!result.ok) throw new Error(result.message);
    expect(checkLayeredPlan(result.state)).toEqual({ kind: 'current', playNow: 35 });
    expectPlaysToTheFinal(result.state);
    const expected = plannedRounds(newOf(checkLayeredPlan(afterSevenJoined())).next);
    for (const { name, rooms } of expected) expect(roomsOf(result.state, name)).toEqual(rooms);
  });

  it('takes the typed numbers of the card into the plan and the stored settings', () => {
    const state = afterSevenJoined();
    const overrides = { layeredRounds: '5' } as const;
    const check = newOf(checkLayeredPlan(state, overrides));
    expect(check.next.bracketRounds.setBy).toBe('organiser');
    const result = acceptLayeredPlan(state, overrides);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.settings?.layeredRounds).toBe('5');
    expect(bracketLogicOf(result.state)).toBe('layered');
  });

  it('refuses a typed number the plan cannot use, in words, and changes nothing', () => {
    const state = afterFiveAbsent();
    const result = acceptLayeredPlan(state, { layeredTopCounts: 'Round 4 - Lower: 7' });
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('cannot be used in Round 4 - Lower'),
    });
  });
});

describe('"Keep the current plan"', () => {
  it('hides the card at that number, and it comes back only when the number who play moves', () => {
    const state = afterSevenJoined();
    const kept = keepLayeredPlan(state);
    expect(layeredKeptPlayOf(kept)).toBe(35);
    expect(checkLayeredPlan(kept)).toEqual({ kind: 'kept', playNow: 35 });
    expect(bracketRooms(kept)).toEqual(bracketRooms(state));
    const oneFewer = removeRosterUnit(kept, players(kept)[10]);
    expect(newOf(checkLayeredPlan(oneFewer)).playNow).toBe(34);
  });

  it('survives a reload: the kept number is in the stored config', () => {
    const kept = keepLayeredPlan(afterSevenJoined());
    const reloaded = JSON.parse(JSON.stringify(kept)) as TournamentState;
    expect(checkLayeredPlan(reloaded)).toEqual({ kind: 'kept', playNow: 35 });
  });

  it('is gone once the new plan is used, and a later move of the number shows the card again', () => {
    const kept = keepLayeredPlan(afterSevenJoined());
    const used = acceptLayeredPlan(kept);
    if (!used.ok) throw new Error(used.message);
    expect(layeredKeptPlayOf(used.state)).toBeUndefined();
    expect(layeredPlayOf(used.state)).toBe(35);
    // One fewer only moves the first Lower rooms: no card. Eight fewer changes the shape: the card is back.
    const oneFewer = removeRosterUnit(used.state, players(used.state)[12]);
    expect(checkLayeredPlan(oneFewer).kind).toBe('current');
    const later = players(used.state)
      .slice(12, 20)
      .reduce((state, unit) => removeRosterUnit(state, unit), used.state);
    expect(newOf(checkLayeredPlan(later)).playNow).toBe(27);
  });

  it('does nothing outside the table: after the first bracket round is drawn the state is unchanged', () => {
    const entered = playToBracketEntry(built(31));
    expect(keepLayeredPlan(entered)).toBe(entered);
  });
});

describe('a late joiner and a withdrawal do not change the bracket by themselves', () => {
  it('late joiners: 35 on the roster, 32 play, a card with a larger bracket; the rooms stay as they were', () => {
    const state = afterThreeAbsent();
    let joined = state;
    for (const name of ['Late A', 'Late B', 'Late C', 'Late D']) {
      const added = addWalkUpIndividual(joined, name, { allowLateJoin: true });
      if (added.status !== 'added') throw new Error(JSON.stringify(added));
      joined = added.state;
    }
    expect(bracketRooms(joined)).toEqual(bracketRooms(state));
    const check = newOf(checkLayeredPlan(joined));
    expect(check.playNow).toBe(32);
    expect(check.next.inBracket.value).toBeGreaterThan(23);
    expect(check.inUse?.inBracket.value).toBe(23);
  });

  it('one late joiner whose number does not change the plan shows no card', () => {
    const added = addWalkUpIndividual(afterThreeAbsent(), 'Late A', { allowLateJoin: true });
    if (added.status !== 'added') throw new Error(JSON.stringify(added));
    expect(checkLayeredPlan(added.state)).toEqual({ kind: 'current', playNow: 29 });
  });

  it('a withdrawal: the rooms stay as they were and the number who play follows the roster', () => {
    const state = afterThreeAbsent();
    const removed = removeRosterUnit(state, players(state)[20]);
    expect(bracketRooms(removed)).toEqual(bracketRooms(state));
    expect(layeredPlayNow(removed)).toBe(27);
  });
});

/** Registered, then who is marked absent in round 1 (and stays absent): the number who play is the roster less them. */
const awkwardCounts = (registered: number, absent: number) => {
  const start = built(registered);
  return playRound(start, players(start).slice(0, absent));
};

describe('a card only when the bracket changes shape: awkward counts', () => {
  // Only the first Lower rooms change (the number in the bracket moves, nothing later does): no card.
  it.each([
    [37, 1, 36],
    [37, 2, 35],
    [43, 6, 37],
    [43, 10, 33],
    [53, 6, 47],
    [53, 9, 44],
    [61, 14, 47],
    [61, 17, 44],
    [80, 10, 70],
  ])('%i registered, %i absent (%i play): no card', (registered, absent, play) => {
    expect(checkLayeredPlan(awkwardCounts(registered, absent))).toEqual({ kind: 'current', playNow: play });
  });

  // The Upper level, the bracket rounds or the later rounds change: the card.
  it.each([
    [37, 5, 32],
    [43, 11, 32],
    [53, 10, 43],
    [61, 1, 60],
    [80, 4, 76],
  ])('%i registered, %i absent (%i play): a card', (registered, absent, play) => {
    expect(newOf(checkLayeredPlan(awkwardCounts(registered, absent))).playNow).toBe(play);
  });

  it('a three-level bracket where only the first Lower rooms change: 80 registered, 70 play', () => {
    const state = awkwardCounts(80, 10);
    expect(checkLayeredPlan(state).kind).toBe('current');
    expect(newOf(checkLayeredPlan(state, { layeredRounds: '6' })).inUse?.levels).toHaveLength(3);
  });
});

describe('differsOnlyInFirstLowerRooms', () => {
  const inUse = () => planFor(31, { play: 28 });
  const next = () => planFor(31, { play: 26 });

  it('is true for the plans of 28 and 26 play at 31 registered: only the first Lower rooms differ', () => {
    expect(inUse().rounds[0].levels.at(-1)?.rooms).toEqual([8, 7]);
    expect(next().rounds[0].levels.at(-1)?.rooms).toEqual([7, 7]);
    expect(differsOnlyInFirstLowerRooms(inUse(), next())).toBe(true);
  });

  it('is true when the Lower level has other room sizes, players and number out in the first round, and no more', () => {
    const changed = next();
    const lower = changed.rounds[0].levels.at(-1);
    if (!lower) throw new Error('no Lower level');
    lower.rooms = [8, 6];
    lower.players = 14;
    lower.out = lower.out + 1;
    changed.rounds[0].out = changed.rounds[0].out + 1;
    changed.levels = changed.levels.map((level) =>
      level.name === 'Lower' ? { ...level, players: 14 } : level,
    );
    expect(differsOnlyInFirstLowerRooms(inUse(), changed)).toBe(true);
  });

  /** Each line of the rule flipped alone, on a copy of the new plan. */
  const flips: Array<[string, (plan: ReturnType<typeof next>) => void]> = [
    ['the level count', (plan) => void (plan.levelCount = { ...plan.levelCount, value: 3 })],
    ['the top level', (plan) => void (plan.topLevel = { ...plan.topLevel, value: 14 })],
    ['the bracket rounds', (plan) => void (plan.bracketRounds = { ...plan.bracketRounds, value: 6 })],
    [
      'what the other half of Semi-Final A do',
      (plan) =>
        void (plan.semiOthers = {
          ...plan.semiOthers,
          value: plan.semiOthers.value === 'wait' ? 'play-on' : 'wait',
        }),
    ],
    ['the last semi-final', (plan) => void (plan.lastSemiFinal = { ...plan.lastSemiFinal, toFinal: 3 })],
    ['the Final', (plan) => void (plan.finalPlayers += 1)],
    [
      'the typed top places',
      (plan) => void plan.topCounts.push({ round: 0, level: 'Lower', top: 3, applies: true }),
    ],
    ['the players the Upper level starts with', (plan) => void (plan.levels[0].players += 1)],
    [
      'the levels (no Lower level)',
      (plan) => void (plan.levels = plan.levels.filter((level) => level.name !== 'Lower')),
    ],
    ['the players waiting in the first round', (plan) => void (plan.rounds[0].waiting += 1)],
    ['Semi-Final A in the first round', (plan) => void (plan.rounds[0].firstSemiFinal = null)],
    [
      'the other half of Semi-Final A in the first round',
      (plan) => void (plan.rounds[0].firstSemiFinal = { others: 'last-semi' }),
    ],
    [
      'the number of Lower rooms in the first round',
      (plan) => void (plan.rounds[0].levels[0].rooms = [5, 5, 5]),
    ],
    ['the Lower top of the first round', (plan) => void (plan.rounds[0].levels[0].top += 1)],
    [
      'where the Lower top go in the first round',
      (plan) => void (plan.rounds[0].levels[0].topGoes = 'through'),
    ],
    ['the number of bracket rounds', (plan) => void plan.rounds.pop()],
    ['the rooms of a later round', (plan) => void (plan.rounds[1].levels[0].rooms = [6, 5])],
    ['the top of a later round', (plan) => void (plan.rounds[1].levels[0].top += 1)],
    ['the number out of a later round', (plan) => void (plan.rounds[1].out += 1)],
    ['the players waiting in a later round', (plan) => void (plan.rounds[1].waiting += 1)],
    ['the players going down in a later round', (plan) => void (plan.rounds[1].levels[0].down += 1)],
  ];

  it('keeps the Upper and Middle rooms of a three-level first round: 80 registered, 72 and 70 play', () => {
    const before = planFor(80, { play: 72 });
    const after = planFor(80, { play: 70 });
    expect(before.levels).toHaveLength(3);
    expect(differsOnlyInFirstLowerRooms(before, after)).toBe(true);
    const changed = structuredClone(after);
    const upper = changed.rounds[0].levels.find((level) => level.level !== 'Lower');
    if (!upper) throw new Error('no level above the Lower level in the first round');
    upper.rooms = [...upper.rooms, 1];
    expect(differsOnlyInFirstLowerRooms(before, changed)).toBe(false);
  });

  it.each(flips)('is false when only %s differs', (_line, flip) => {
    const changed = structuredClone(next());
    flip(changed);
    expect(differsOnlyInFirstLowerRooms(inUse(), changed)).toBe(false);
  });
});

describe('the plans kept between checks', () => {
  it('give the answer planning gives, after the number who play changes and comes back', () => {
    const state = afterSevenJoined();
    const twelveFewer = players(state)
      .slice(12, 24)
      .reduce((current, unit) => removeRosterUnit(current, unit), state);
    const before = checkLayeredPlan(state);
    expect(newOf(checkLayeredPlan(twelveFewer)).playNow).toBe(23);
    expect(checkLayeredPlan(state)).toEqual(before);
    for (const play of [35, 23, 35, 31, 35]) {
      const form = { ...state.settings, layeredExpected: `${play}` } as LayeredForm;
      expect(planLayeredFor(form, 38, FIRST_ROUND)).toEqual(planLayeredForUncached(form, 38, FIRST_ROUND));
    }
  });

  it('a score that leaves the number who play as it is gives the same check', () => {
    const state = afterSevenJoined();
    const scored = { ...state, scores: { ...state.scores, 'r2-rm0-p0': 7 } };
    expect(checkLayeredPlan(scored)).toEqual(checkLayeredPlan(state));
  });
});
