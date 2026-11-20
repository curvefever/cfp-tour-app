import { deriveRoomSize, getGameFormat, POOLING_PHASE_WORDS } from './formats';
import { layeredGraphText } from './layered-graph';
import { planLayered, type LayeredPlan } from './layered-plan';
import { roundsBeforeBracket } from './pooling-rounds';
import type { GameFormatKey, PersistedSetup, PoolingPhaseKey, RoomSize } from './types';

/**
 * What the Setup form and a head count make of a layered bracket: the gate (which game formats and which pooling phases
 * it is written for), the plan, and the graph text the Custom bracket engine plays. The two lists are the only place
 * that says where it is offered: widening it means adding entries.
 */

/** The game formats a layered bracket is written for: free-for-all rooms. */
export const LAYERED_FORMATS: readonly GameFormatKey[] = ['ffa-individual'];

/** The pooling phases a layered bracket can follow: a qualification table, which ranks the players into levels. */
export const LAYERED_POOLING_PHASES: readonly PoolingPhaseKey[] = ['qual-table'];

/** Each pooling phase as a refusal names it. */
const POOLING_PHASE_WHERE: Record<PoolingPhaseKey, string> = {
  none: 'without a pooling phase',
  'qual-table': 'after a qualification table',
  swiss: 'after a Swiss',
  'group-stage': 'after a group stage',
};

const ALTERNATIVES =
  'pick the upper and lower bracket, single elimination or the Custom bracket (built by hand) instead';

export type LayeredForm = Pick<
  PersistedSetup,
  | 'gameFormat'
  | 'poolingPhase'
  | 'qualRoundsOverride'
  | 'swissRoundsOverride'
  | 'groupSize'
  | 'roundRobinMode'
>;

/** Why a layered bracket is not offered for this game format and pooling phase, or null when it is. */
export function layeredGateRefusal(form: Pick<LayeredForm, 'gameFormat' | 'poolingPhase'>): string | null {
  if (!LAYERED_FORMATS.includes(form.gameFormat)) {
    const label = getGameFormat(form.gameFormat)?.label ?? form.gameFormat;
    const written = LAYERED_FORMATS.map((key) => getGameFormat(key)?.label ?? key).join(' or ');
    return `A layered bracket is not available for ${label} yet: it is written for ${written}. Please ${ALTERNATIVES}.`;
  }
  if (!LAYERED_POOLING_PHASES.includes(form.poolingPhase)) {
    const follows = LAYERED_POOLING_PHASES.map((phase) => POOLING_PHASE_WORDS[phase].recap.toLowerCase());
    return `A layered bracket cannot be written ${POOLING_PHASE_WHERE[form.poolingPhase]} yet: it follows the ${follows.join(' or the ')}. Choose a qualification table, or ${ALTERNATIVES}.`;
  }
  return null;
}

export type LayeredFormPlan =
  { ok: true; plan: LayeredPlan; roomSize: RoomSize; firstRound: number } | { ok: false; message: string };

/** The plan for the form and the head count, or why there is none: the gate first, then the plan's own refusals. */
export function planLayeredFor(form: LayeredForm, registered: number): LayeredFormPlan {
  const gate = layeredGateRefusal(form);
  if (gate) return { ok: false, message: gate };
  const format = getGameFormat(form.gameFormat);
  if (!format) return { ok: false, message: 'This game format is not available yet.' };
  const roomSize = deriveRoomSize(format);
  const planned = planLayered({ registered, roomSize });
  if (!planned.ok) return planned;
  return {
    ok: true,
    plan: planned.plan,
    roomSize,
    firstRound: roundsBeforeBracket(form, registered) + 1,
  };
}

/** The graph text of the layered bracket for the form and the head count, or why there is none. */
export function layeredGraphFor(
  form: LayeredForm,
  registered: number,
): { ok: true; text: string; play: number } | { ok: false; message: string } {
  const planned = planLayeredFor(form, registered);
  if (!planned.ok) return planned;
  return {
    ok: true,
    text: layeredGraphText(planned.plan, planned.firstRound),
    play: planned.plan.play.value,
  };
}
