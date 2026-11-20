import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { checkLayeredPlan } from '../../domain/tournament/layered-replan';
import { roundsInPlay } from '../../domain/tournament/round-columns';
import type { UnscoredRoom } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

/**
 * What the confirmation before Next Round says about rooms with no score: "No score yet in Room B. Go to the
 * next round anyway?". A column of several rounds names each room with its round ("Round 5 Lower · Room B"),
 * as the tie banners do.
 */
export function unscoredRoomsMessage(state: TournamentState, rooms: UnscoredRoom[]): string {
  const several = roundsInPlay(state).length > 1;
  const labels = bracketRoundLabels(state);
  const names = rooms.map(({ roundIndex, room }) => {
    const roomName = `Room ${roomLetter(room)}`;
    return several ? `${labels[roundIndex]?.label ?? ''} · ${roomName}` : roomName;
  });
  return `No score yet in ${names.join(', ')}. Go to the next round anyway?`;
}

/** The confirmation in dependency play: every room not fully scored, each named with its round. */
export function incompleteRoomsMessage(
  state: TournamentState,
  rooms: Array<{ roundIndex: number; room: number }>,
): string {
  const labels = bracketRoundLabels(state);
  const names = rooms.map(
    ({ roundIndex, room }) => `${labels[roundIndex]?.label ?? ''} · Room ${roomLetter(room)}`,
  );
  return `Not all scores in: ${names.join(', ')}. Go on anyway?`;
}

/**
 * Said on the last table round of a layered bracket while a new plan is waiting in the running Admin ("A NEW PLAN FOR THE
 * BRACKET"): Next Round plays the plan in use unless the organiser uses the new one first. Null when no plan waits, or the
 * round in play is not the last table round.
 */
export function layeredPlanWarning(state: TournamentState): string | null {
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  if (first === -1 || state.curRound !== first - 1) return null;
  const check = checkLayeredPlan(state);
  if (check.kind !== 'new') return null;
  return `A new plan for the bracket is waiting in Admin: ${check.playNow} play now. Next Round plays the plan in use.`;
}
