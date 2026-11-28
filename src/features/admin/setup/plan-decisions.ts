import { unitLabelPluralLower } from '../../../domain/tournament/formats';
import type { GenerationForm } from '../../../domain/tournament/generation-plan-types';
import { groupExitIsTotal } from '../../../domain/tournament/group-exit';
import { expectedToPlay } from '../../../domain/tournament/bracket-entry-default';
import { isPoolingRound } from '../../../domain/tournament/pooling';
import { poolingRoundsOf } from '../../../domain/tournament/pooling-rounds';
import {
  previewRuntime,
  previewSchedule,
  type SchedulePreview,
} from '../../../domain/tournament/schedule-preview';
import type { TournamentRound, TournamentState } from '../../../domain/tournament/types';
import { standingsKindOfSetup } from '../../../domain/tournament/waterfall-numbering';
import { groupSizesText } from '../../tournament/components/group-exit-text';
import { visibleFormatFields } from './format-fields';
import { plural } from './plural';

/**
 * The numbers of the app's plan, as the Setup lists them: each one the app's or typed. Every number is read from a
 * preview, which is generation itself (`previewSchedule`).
 */
export interface PlanDecision {
  label: string;
  text: string;
  source: 'app' | 'typed';
}

type GeneratedPreview = Extract<SchedulePreview, { status: 'generated' }>;

function decision(label: string, text: string, typed: boolean): PlanDecision {
  return { label, text, source: typed ? 'typed' : 'app' };
}

const isTyped = (field: string) => field.trim() !== '';

function notCountedText(count: number): string {
  if (count === 0) return 'none';
  return count === 1 ? 'the first round' : `the first ${count} rounds`;
}

/** The table's or the Swiss's rounds and uncounted rounds, or the group sizes; nothing with no pooling phase. */
function poolingDecisions(form: GenerationForm, { state, plan }: GeneratedPreview): PlanDecision[] {
  if (form.poolingPhase === 'none') return [];
  if (form.poolingPhase === 'group-stage') {
    const sizes = state.groups.map((group) => group.members.length);
    return [decision('Group stage', groupSizesText(sizes), false)];
  }
  const { rounds, nonCounting } = poolingRoundsOf(form, plan.unitCount);
  const phase = form.poolingPhase === 'swiss' ? 'Swiss' : 'Qualification';
  return [
    decision(phase, plural(rounds.value, 'round'), rounds.typed),
    decision('Not counted', notCountedText(nonCounting.value), nonCounting.typed),
  ];
}

/** "18 rooms of 2" when every room has the same size, else the sizes: "8 · 8 · 7 · 7 · 7". */
function roomsText(rooms: readonly number[]): string {
  const sameSize = rooms.every((size) => size === rooms[0]);
  return sameSize ? `${plural(rooms.length, 'room')} of ${rooms[0]}` : rooms.join(' · ');
}

/** The rooms and byes of the first pooling round. */
function roomDecisions({ state }: GeneratedPreview): PlanDecision[] {
  const { rooms, byeCount } = state.rounds[0];
  if (!rooms.length) return [];
  const byes = byeCount ? `, ${plural(byeCount, 'bye')}` : '';
  return [decision('Rooms', `${roomsText(rooms)}${byes}`, false)];
}

/**
 * Whether Setup has an "Advance to bracket" field for these choices. A Custom bracket fed by the pooling standings
 * takes its number from the graph, and the upper and lower and the layered bracket keep theirs in their own panels.
 */
function hasAdvanceField(form: GenerationForm): boolean {
  if (standingsKindOfSetup(form) !== null) return false;
  if (form.poolingPhase !== 'group-stage') return visibleFormatFields(form).has('qualAdv');
  const appWritten = form.scheduleLogic === 'upper-lower' || form.scheduleLogic === 'layered';
  return !appWritten && groupExitIsTotal(form);
}

function entryDecisions(form: GenerationForm, { plan }: GeneratedPreview): PlanDecision[] {
  if (!hasAdvanceField(form)) return [];
  const text = `${plan.bracketEntryCount} of ${expectedToPlay(plan.unitCount)} expected`;
  return [decision('In the bracket', text, isTyped(form.qualAdv))];
}

const stageRound = (state: TournamentState, stage: 'isSemis' | 'isFinal') =>
  state.rounds.find((round) => round[stage]);

/** The seats of the Semis or the Final. */
const seatsOf = (state: TournamentState, stage: 'isSemis' | 'isFinal') => stageRound(state, stage)?.players;

function sizeDecisions(form: GenerationForm, { state }: GeneratedPreview): PlanDecision[] {
  if (form.scheduleLogic !== 'single-elimination') return [];
  const units = unitLabelPluralLower(form.gameFormat);
  const semis = stageRound(state, 'isSemis');
  const final = stageRound(state, 'isFinal');
  const lines: PlanDecision[] = [];
  if (semis) {
    // The override counts units, so the line shows the rooms they make too.
    const text = `${semis.players} ${units} (${roomsText(semis.rooms)})`;
    lines.push(decision('Semis', text, isTyped(form.semisOverride)));
  }
  if (final) lines.push(decision('Final', `${final.players} ${units}`, isTyped(form.finalOverride)));
  return lines;
}

/** The typed survivor counts; the app's own show as what each round's row advances. */
function targetDecisions({ plan }: GeneratedPreview): PlanDecision[] {
  return plan.explicitTargets ? [decision('Survivors', plan.explicitTargets.join(', '), true)] : [];
}

/** The lines of the plan, in the order shown; a format without a number has no line for it. */
export function planDecisions(form: GenerationForm, preview: GeneratedPreview): PlanDecision[] {
  return [
    ...poolingDecisions(form, preview),
    ...roomDecisions(preview),
    ...entryDecisions(form, preview),
    ...sizeDecisions(form, preview),
    ...targetDecisions(preview),
  ];
}

/** The Setup fields that have a number of the app's own while they are empty. */
export type AppValueField =
  | 'qualRoundsOverride'
  | 'swissRoundsOverride'
  | 'nonCountingRounds'
  | 'qualAdv'
  | 'semisOverride'
  | 'finalOverride'
  | 'eliminationRoundTargets';

/** A round whose survivors the targets list sets: a winners round of a shared Final, else a cut before the Semis. */
function isTargetRound(round: TournamentRound, schedule: string): boolean {
  if (schedule === 'double-elimination-shared-final') return round.bracket === 'winners';
  return !isPoolingRound(round) && !round.isSemis && !round.isFinal;
}

function survivorsText({ state, plan }: GeneratedPreview): string | null {
  const survivors = state.rounds.filter((round) => isTargetRound(round, plan.schedule));
  return survivors.length ? survivors.map((round) => round.advTotal).join(', ') : null;
}

const numberText = (value: number | undefined) => (value === undefined ? null : String(value));

const APP_VALUES: Record<AppValueField, (preview: GeneratedPreview) => string | null> = {
  qualRoundsOverride: ({ plan }) => numberText(plan.qualRounds),
  swissRoundsOverride: ({ plan }) => numberText(plan.swissRounds),
  nonCountingRounds: ({ plan }) => numberText(plan.nonCountingRounds),
  qualAdv: ({ plan }) => numberText(plan.bracketEntryCount),
  semisOverride: ({ state }) => numberText(seatsOf(state, 'isSemis')),
  finalOverride: ({ state }) => numberText(seatsOf(state, 'isFinal')),
  eliminationRoundTargets: survivorsText,
};

/** A field's number as a plan has it. For an empty field it is the app's own. */
export function appValueFrom(field: AppValueField, preview: GeneratedPreview): string | null {
  return APP_VALUES[field](preview);
}

/** The form with one field left to the app. The reseed modes are listed per survivor count, so they go with that list. */
function formWithout(form: GenerationForm, field: AppValueField): GenerationForm {
  const modes = field === 'eliminationRoundTargets' ? { eliminationSeedingOverrides: '' } : {};
  return { ...form, [field]: '', ...modes };
}

/**
 * The number the app would use for a field Setup shows, whatever is typed in it: the plan worked out again with the
 * field empty. Null when that plan is refused or has no such number.
 */
export function appValueOf(
  field: AppValueField,
  current: TournamentState,
  form: GenerationForm,
  unitCount: number,
): string | null {
  const preview = previewSchedule(current, formWithout(form, field), unitCount, previewRuntime());
  return preview.status === 'generated' ? appValueFrom(field, preview) : null;
}
