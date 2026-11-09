import { deriveRoomSize, getGameFormat, unitLabelPluralLower } from './formats';
import { registeredBelowFloorMessage } from './generation';
import { matchFormatConfig, parseMatchOverrides, stageFormat } from './round-match-formats';
import type { PersistedSetup, RoomSize } from './types';
import { planUpperLower, upperLowerGraphText, upperLowerStageOf, type UpperLowerRound } from './upper-lower';
import { matchFormatToken, parseMatchFormatToken } from './waterfall-bracket';

/**
 * What the Setup form and a head count make of an upper and lower bracket, read by the Setup panel and by "Adjust
 * rounds by hand": the plan, or why there is none (the floor of the format first, then the words generation refuses
 * with).
 */
export type UpperLowerFormPlan =
  | { ok: true; plan: Extract<ReturnType<typeof planUpperLower>, { ok: true }>; roomSize: RoomSize }
  | { ok: false; message: string };

export function planUpperLowerFor(form: PersistedSetup, registered: number): UpperLowerFormPlan {
  const format = getGameFormat(form.gameFormat);
  if (!format) return { ok: false, message: 'This game format is not available yet.' };
  const roomSize = deriveRoomSize(format);
  const unitPlural = unitLabelPluralLower(form.gameFormat);
  const tooFew = registeredBelowFloorMessage('upper-lower', roomSize, unitPlural, registered);
  if (tooFew) return { ok: false, message: tooFew };
  const plan = planUpperLower(form, registered, roomSize, unitPlural);
  return plan.ok ? { ok: true, plan, roomSize } : plan;
}

/** The match format of a round as a ROUNDS-line token, or '' for the default single game. */
function tokenOf(round: UpperLowerRound, form: PersistedSetup): string {
  if (round.isFinal) return '';
  const config = matchFormatConfig(form, 'upper-lower');
  const override = parseMatchFormatToken(parseMatchOverrides(form.matchOverrides)[round.name] ?? '');
  const match = override ?? stageFormat(upperLowerStageOf(round.name, false), config);
  return match.bestOf !== undefined || match.games !== 1 ? matchFormatToken(match) : '';
}

export type UpperLowerByHand = { ok: true; text: string } | { ok: false; message: string };

/**
 * The graph text "Adjust rounds by hand" hands to the Custom bracket: the worked-out rounds, each with the match
 * format the Setup selects and the per-round overrides gave it (the Final carries none, as a graph Final plays the
 * Finals format).
 */
export function upperLowerByHand(form: PersistedSetup, registered: number): UpperLowerByHand {
  const planned = planUpperLowerFor(form, registered);
  if (!planned.ok) return planned;
  const { plan, roomSize } = planned;
  return {
    ok: true,
    text: upperLowerGraphText(plan.entry, roomSize, plan.firstRound, plan.source, plan.upper, (round) =>
      tokenOf(round, form),
    ),
  };
}
