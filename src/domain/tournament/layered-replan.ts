import { layeredReplannable, markAppWrittenStages } from './app-written-bracket';
import { expectedToPlay } from './bracket-entry-default';
import { generatedConfig } from './generated-config';
import { layeredGraphText } from './layered-graph';
import { planLayeredFor, type LayeredForm } from './layered-form';
import type { LayeredPlan } from './layered-plan';
import type { BracketRound } from './layered-search';
import { likelyAbsentees } from './likely-absentees';
import { rosterKeys } from './roster';
import { applyMatchFormats } from './round-match-formats';
import { layeredKeptPlayOf, layeredPlayOf, withLayeredKept, withLayeredPlay } from './rule-versions';
import { MISSING_ROOM_SIZE_MESSAGE } from './round-advance-tools';
import type { TournamentSettings, TournamentState } from './types';
import { applyWaterfallGraphEdit } from './waterfall-live-edit';

/**
 * A layered bracket planned again while the table runs (`docs/rules.md`, "Layered bracket"). The number who play now is
 * the roster less the players absent from their last round and not back; the app's plan for it is made from the
 * settings the tournament was generated with (everything typed stays as typed, "Expected to play" is that number). When
 * it differs from the plan in use, the running Admin shows both and the organiser chooses: nothing changes by itself.
 * Only until the first bracket round is drawn, and only while the layered mark is set: a hand edit ends it.
 */

/** The typed numbers the organiser may change when a new plan is offered. "Expected to play" is the number who play now. */
export const LAYERED_OVERRIDE_KEYS = [
  'layeredInBracket',
  'layeredRounds',
  'layeredLevels',
  'layeredTop',
  'layeredTopCounts',
  'layeredSemiOthers',
] as const;

export type LayeredOverrides = Partial<Pick<TournamentSettings, (typeof LAYERED_OVERRIDE_KEYS)[number]>>;

export type LayeredPlanCheck =
  /** Not a layered bracket, its bracket is entered, or it has no settings: nothing is planned again. */
  | { kind: 'none' }
  /** The plan for the number who play now cannot be made (or saved): why, and the plan in use stays. */
  | { kind: 'refused'; message: string }
  /** The plan for the number who play now is the plan in use, or differs from it only in the first Lower rooms. */
  | { kind: 'current'; playNow: number }
  /** It differs, and the organiser kept the plan in use at this number who play. */
  | { kind: 'kept'; playNow: number }
  /** It differs: both plans, for the card. `inUse` is null when it cannot be worked out again from the settings. */
  | {
      kind: 'new';
      playNow: number;
      registered: number;
      firstRound: number;
      inUse: LayeredPlan | null;
      next: LayeredPlan;
    };

/** The number who play now: the roster less the units absent from their last round and not back; before the first table round is sent on, the number expected. */
export function layeredPlayNow(state: TournamentState): number {
  const roster = rosterKeys(state.players);
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  if (state.curRound === 0 || first === -1) {
    const typed = Number(state.settings?.layeredExpected ?? '');
    return Number.isInteger(typed) && typed > 0 ? typed : expectedToPlay(roster.length);
  }
  const inRoster = new Set(roster);
  const absent = [...likelyAbsentees(state, first)].filter((unit) => inRoster.has(unit));
  return roster.length - absent.length;
}

const withoutPlayNumbers = (config: TournamentState['gamemodeConfig']) => {
  const { layeredPlay: _play, layeredKeptPlay: _kept, ...rest } = config;
  return rest;
};

const sameBracket = (before: TournamentState, after: TournamentState): boolean =>
  JSON.stringify([before.rounds, before.cfg, withoutPlayNumbers(before.gamemodeConfig)]) ===
  JSON.stringify([after.rounds, after.cfg, withoutPlayNumbers(after.gamemodeConfig)]);

type Planned =
  | { ok: false; message: string }
  | {
      ok: true;
      settings: TournamentSettings;
      firstRound: number;
      first: number;
      registered: number;
      next: LayeredPlan;
    };

/** The app's plan for the number who play now, from the stored settings and the typed numbers that replace some of them. */
function planFromState(state: TournamentState, overrides: LayeredOverrides, playNow: number): Planned {
  const replannable = layeredReplannable(state);
  if (!replannable || !state.settings) return { ok: false, message: '' };
  if (!generatedConfig(state)) return { ok: false, message: MISSING_ROOM_SIZE_MESSAGE };
  const settings = { ...state.settings, ...overrides };
  const registered = rosterKeys(state.players).length;
  const firstRound = state.rounds[replannable.first].roundNum;
  const form = { ...settings, layeredExpected: `${playNow}` } as LayeredForm;
  const next = planLayeredFor(form, registered, firstRound);
  if (!next.ok) return next;
  return { ok: true, settings, firstRound, first: replannable.first, registered, next: next.plan };
}

/** The plan in use, made again from the stored settings and the number it was made for. Null when that no longer gives a plan. */
function planInUse(state: TournamentState, firstRound: number, registered: number): LayeredPlan | null {
  const play = layeredPlayOf(state);
  if (play === undefined || !state.settings) return null;
  const form = { ...state.settings, layeredExpected: `${play}` } as LayeredForm;
  const made = planLayeredFor(form, Math.max(registered, play), firstRound);
  return made.ok ? made.plan : null;
}

const sameValue = (first: unknown, second: unknown): boolean =>
  JSON.stringify(first) === JSON.stringify(second);

/** The first bracket round of two plans, the Lower level's room sizes and number out left aside: the rest must be equal. */
function sameFirstRoundBesidesLower(inUse: BracketRound, next: BracketRound): boolean {
  if (inUse.waiting !== next.waiting || !sameValue(inUse.firstSemiFinal, next.firstSemiFinal)) return false;
  if (inUse.levels.length !== next.levels.length) return false;
  return inUse.levels.every((level, index) => {
    const other = next.levels[index];
    if (level.level !== 'Lower') return sameValue(level, other);
    return (
      level.level === other.level &&
      level.rooms.length === other.rooms.length &&
      level.top === other.top &&
      level.topGoes === other.topGoes
    );
  });
}

/**
 * Whether two plans differ only in the Lower level's first bracket round: the same levels and rounds, every other level
 * starting with the same players in the same rooms, the Lower level with the same number of rooms and the same top `k`
 * (only its room sizes and the number out differ), and every later round the same. Such a change leaves the later
 * bracket as it is, so it is not worth ending one more player's tournament for (`docs/rules.md`, "Layered bracket").
 */
export function differsOnlyInFirstLowerRooms(inUse: LayeredPlan, next: LayeredPlan): boolean {
  const [inUseFirst, ...inUseLater] = inUse.rounds;
  const [nextFirst, ...nextLater] = next.rounds;
  if (!inUseFirst || !nextFirst) return false;
  const entryBesidesLower = (plan: LayeredPlan) => plan.levels.filter((level) => level.name !== 'Lower');
  const lowerLevels = (plan: LayeredPlan) => plan.levels.filter((level) => level.name === 'Lower').length;
  const sameShape = (plan: LayeredPlan) => [
    plan.levelCount.value,
    plan.topLevel.value,
    plan.bracketRounds.value,
    plan.semiOthers.value,
    plan.lastSemiFinal,
    plan.finalPlayers,
    plan.topCounts,
  ];
  return (
    lowerLevels(inUse) === 1 &&
    lowerLevels(next) === 1 &&
    sameValue(sameShape(inUse), sameShape(next)) &&
    sameValue(entryBesidesLower(inUse), entryBesidesLower(next)) &&
    sameFirstRoundBesidesLower(inUseFirst, nextFirst) &&
    sameValue(inUseLater, nextLater)
  );
}

type Replanned = { ok: true; state: TournamentState } | { ok: false; message: string };

/**
 * The state with the graph of the new plan saved the way a hand edit saves it (`applyWaterfallGraphEdit`): the pooling
 * rounds, their scores and the tie picks that still apply are kept. The new bracket rounds get their stages and match
 * formats again (a per-round override stays by round name), the layered mark stays, and the number the plan was made for
 * becomes the number who play now.
 */
function replannedState(
  state: TournamentState,
  planned: Extract<Planned, { ok: true }>,
  playNow: number,
): Replanned {
  const text = layeredGraphText(planned.next, planned.firstRound);
  const edited = applyWaterfallGraphEdit(state, text);
  if (!edited.ok) return { ok: false, message: edited.error };
  const { first } = planned;
  const staged = [
    ...edited.state.rounds.slice(0, first),
    ...markAppWrittenStages(edited.state.rounds.slice(first)),
  ];
  const gamemodeConfig = edited.state.gamemodeConfig;
  return {
    ok: true,
    state: {
      ...edited.state,
      settings: planned.settings,
      gamemodeConfig: withLayeredPlay(gamemodeConfig, playNow),
      rounds: applyMatchFormats(staged, gamemodeConfig, first),
    },
  };
}

/**
 * Whether the running Admin offers a new plan: the app's plan for the number who play now, against the plan in use. It
 * differs when saving it would change the rounds, rooms or routes. `overrides` are the typed numbers the organiser is
 * trying in the card.
 */
export function checkLayeredPlan(state: TournamentState, overrides: LayeredOverrides = {}): LayeredPlanCheck {
  if (!layeredReplannable(state) || !state.settings) return { kind: 'none' };
  const playNow = layeredPlayNow(state);
  // The plan in use was made from these settings for the number it was made for, and kept at the number it was kept at:
  // at either number the answer is known without planning (this runs on every render of the Next Round panel).
  if (Object.keys(overrides).length === 0) {
    if (playNow === layeredPlayOf(state)) return { kind: 'current', playNow };
    if (playNow === layeredKeptPlayOf(state)) return { kind: 'kept', playNow };
  }
  const planned = planFromState(state, overrides, playNow);
  if (!planned.ok) return planned.message ? { kind: 'refused', message: planned.message } : { kind: 'none' };
  const candidate = replannedState(state, planned, playNow);
  if (!candidate.ok) return { kind: 'refused', message: candidate.message };
  const typedChanged = Object.keys(overrides).some(
    (key) => overrides[key as keyof LayeredOverrides] !== state.settings?.[key as keyof LayeredOverrides],
  );
  if (!typedChanged && sameBracket(state, candidate.state)) return { kind: 'current', playNow };
  const inUse = planInUse(state, planned.firstRound, planned.registered);
  // A card is for a change in the bracket's shape: not for one that only moves the first Lower rooms (nothing typed),
  // unless the plan in use can no longer be played (fewer play than it has in the bracket).
  if (
    Object.keys(overrides).length === 0 &&
    inUse !== null &&
    playNow >= inUse.inBracket.value &&
    differsOnlyInFirstLowerRooms(inUse, planned.next)
  ) {
    return { kind: 'current', playNow };
  }
  if (!typedChanged && layeredKeptPlayOf(state) === playNow) return { kind: 'kept', playNow };
  return {
    kind: 'new',
    playNow,
    registered: planned.registered,
    firstRound: planned.firstRound,
    inUse,
    next: planned.next,
  };
}

/** "Use the new plan": the plan for the number who play now saved, with the typed numbers of the card, or why not. */
export function acceptLayeredPlan(state: TournamentState, overrides: LayeredOverrides = {}): Replanned {
  if (!layeredReplannable(state) || !state.settings) {
    return {
      ok: false,
      message: 'The bracket has been entered or edited by hand: its plan is no longer worked out again.',
    };
  }
  const playNow = layeredPlayNow(state);
  const planned = planFromState(state, overrides, playNow);
  if (!planned.ok) return { ok: false, message: planned.message };
  return replannedState(state, planned, playNow);
}

/** "Keep the current plan": the card stays away until the number who play moves from the number it is kept at. */
export function keepLayeredPlan(state: TournamentState): TournamentState {
  if (!layeredReplannable(state)) return state;
  return { ...state, gamemodeConfig: withLayeredKept(state.gamemodeConfig, layeredPlayNow(state)) };
}

/** Whether a new plan is waiting in the running Admin (the card is shown): for the Next Round warning. */
export const layeredPlanWaiting = (state: TournamentState): boolean => checkLayeredPlan(state).kind === 'new';
