import { bracketRoundLabels } from '../../domain/tournament/bracket';
import type { TournamentState } from '../../domain/tournament/types';
import type { NextRoundPlan } from '../../domain/tournament/waterfall-steps';

/** "A", "A and B", "A, B and C". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function labelsOf(state: TournamentState, rounds: number[]): string[] {
  const labels = bracketRoundLabels(state);
  return rounds.map((index) => labels[index]?.label ?? `Round ${state.rounds[index]?.roundNum}`);
}

/**
 * The line under the Next Round button in dependency play, from what the press does (`nextRoundPlan`): "Draws R6L and
 * R6R. SemiA stays in play.", "Sends on R6R. R6L stays in play." when nothing can be drawn yet, "Nothing is finished:
 * Next Round sends on SemiA as it stands." when it has to be confirmed, or what blocks it. Null when there is no press.
 */
export function nextRoundLine(state: TournamentState, plan: NextRoundPlan): string | null {
  if (plan.hidden) return null;
  if (plan.blocked === 'pending-ties') return 'Nothing is finished. Resolve the tie-break above first.';
  if (plan.blocked === 'pending-absences') return 'Nothing is finished. Answer the scores of 0 above first.';
  const stays = plan.staysInPlay.length
    ? ` ${listOf(labelsOf(state, plan.staysInPlay))} ${plan.staysInPlay.length > 1 ? 'stay' : 'stays'} in play.`
    : '';
  const again = plan.clears.length
    ? ` ${listOf(labelsOf(state, plan.clears))} ${plan.clears.length > 1 ? 'are' : 'is'} sent on again as ${plan.clears.length > 1 ? 'they stand' : 'it stands'}.`
    : '';
  if (plan.confirm) {
    return `Nothing is finished: Next Round sends on ${listOf(labelsOf(state, plan.sends))} as ${plan.sends.length > 1 ? 'they stand' : 'it stands'}.${stays}${again}`;
  }
  const drawn = plan.draws.length
    ? `Draws ${listOf(labelsOf(state, plan.draws))}.`
    : plan.sends.length
      ? `Sends on ${listOf(labelsOf(state, plan.sends))}; nothing to draw yet.`
      : '';
  return `${drawn}${stays}${again}`.trim();
}

/**
 * The note above the action bar in dependency play while a press is reopened by Previous: the rounds are in play
 * again, and a correction in them does not change the draw of the rounds they drew. Null when no step is reopened.
 */
export function reopenedNote(state: TournamentState): string | null {
  const reopened = (state.waterfallSteps ?? []).filter((step) => step.reopened);
  if (reopened.length === 0) return null;
  const sent = [...new Set(reopened.flatMap((step) => step.sent))].sort((a, b) => a - b);
  const drew = [...new Set(reopened.flatMap((step) => step.drew ?? []))].sort((a, b) => a - b);
  const reopenedText = `${listOf(labelsOf(state, sent))} ${sent.length > 1 ? 'are' : 'is'} open again.`;
  const drawText = drew.length
    ? ` ${listOf(labelsOf(state, drew))} ${drew.length > 1 ? 'are' : 'is'} already drawn: a correction here won't change ${drew.length > 1 ? 'their draw' : 'its draw'}.`
    : '';
  return `${reopenedText}${drawText}`;
}
