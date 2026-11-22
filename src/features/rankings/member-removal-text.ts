import { removeTeamMember } from '../../domain/tournament/member-swaps';
import type { TournamentState } from '../../domain/tournament/types';

/** What the organiser is told after a member was removed: who the defender is now, or that the team has no member left; null when nothing else changed. */
export function removalNotice(
  removedName: string,
  teamName: string,
  newDefender: string | null,
  membersLeft: number,
): string | null {
  if (newDefender) return `${removedName} was removed. ${newDefender} is now the defender of ${teamName}.`;
  return membersLeft === 0 ? `${removedName} was removed. ${teamName} has no member left.` : null;
}

/** Removes a team member and answers the new state with the notice to show, or the reason the removal was refused. */
export function removeMemberWithNotice(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
): { state: TournamentState; notice: string | null } | { refusal: string } {
  const unit = state.players.find((entry) => typeof entry === 'object' && entry.teamId === teamId);
  const team = typeof unit === 'object' ? unit : undefined;
  const removed = team?.members[memberIndex]?.name ?? '';
  const result = removeTeamMember(state, teamId, memberIndex);
  if (typeof result === 'string') return { refusal: result };
  const after = result.state.players.find((entry) => typeof entry === 'object' && entry.teamId === teamId);
  const membersLeft =
    typeof after === 'object' ? after.members.filter((member) => member !== null).length : 0;
  return {
    state: result.state,
    notice: removalNotice(removed, team?.teamName ?? teamId, result.newDefender, membersLeft),
  };
}
