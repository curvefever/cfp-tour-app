import { unmarkOneScoreTeamMemberAbsent } from './absences';
import { getGameFormat } from './formats';
import { updateTeam } from './mutations';
import { findUnstorableNames, rosterNames, unstorableNamesMessage } from './roster';
import { currentColumn } from './round-columns';
import type { TeamMember, TournamentState, TournamentTeam } from './types';

/**
 * Individual reserves and member swaps of a team format. They change no schedule and no draw (a team's rooms and
 * scores are stored by seat and slot), so no reserve window applies: they work before the start and in any round.
 */

/** The names in use across the roster, lower-cased; the outgoing member and one reserve entry do not count. */
function namesInUse(state: TournamentState, outgoing?: string, ignoredReserve?: number): string[] {
  const names = [
    ...rosterNames(state.players),
    ...rosterNames(state.reserves),
    ...state.reserveIndividuals.filter((_, index) => index !== ignoredReserve).map((member) => member.name),
  ];
  const at = outgoing === undefined ? -1 : names.indexOf(outgoing);
  return names.filter((_, index) => index !== at).map((name) => name.trim().toLowerCase());
}

/** Why a name can't be added or swapped in, or null when it is free to use. */
function nameRefusal(state: TournamentState, name: string, outgoing?: string, ignoredReserve?: number) {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name.';
  const unstorable = findUnstorableNames([trimmed]);
  if (unstorable.length) return unstorableNamesMessage(unstorable);
  if (namesInUse(state, outgoing, ignoredReserve).includes(trimmed.toLowerCase())) {
    return `"${trimmed}" is already registered — pick a different name.`;
  }
  return null;
}

const isTeamFormat = (state: TournamentState) => Boolean(getGameFormat(state.gameFormat)?.teamSize);

/** Why an individual reserve can't be added, or null. Team formats only. */
export function reserveIndividualRefusal(state: TournamentState, member: TeamMember): string | null {
  if (!isTeamFormat(state)) return 'Individual reserves are only for team formats.';
  return nameRefusal(state, member.name);
}

/** Adds an individual reserve (a player who can fill a vacant slot or replace a member), at any time. */
export function addReserveIndividual(state: TournamentState, member: TeamMember): TournamentState {
  if (reserveIndividualRefusal(state, member)) return state;
  const name = member.name.trim();
  const added: TeamMember = member.userId ? { name, userId: member.userId } : { name };
  return { ...state, reserveIndividuals: [...state.reserveIndividuals, added] };
}

export function removeReserveIndividual(state: TournamentState, index: number): TournamentState {
  if (!state.reserveIndividuals[index]) return state;
  return { ...state, reserveIndividuals: state.reserveIndividuals.filter((_, at) => at !== index) };
}

function teamOf(state: TournamentState, teamId: string): TournamentTeam | undefined {
  return isTeamFormat(state)
    ? (state.players as TournamentTeam[]).find((team) => team.teamId === teamId)
    : undefined;
}

/** Why a member swap is refused, or null when it can go ahead. `reserveIndex` says the newcomer is that individual reserve. */
export function memberSwapRefusal(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  incoming: TeamMember,
  reserveIndex?: number,
): string | null {
  const team = teamOf(state, teamId);
  if (!team) return "That team isn't in the tournament.";
  const outgoing = team.members[memberIndex];
  if (!outgoing) return 'That slot is vacant — fill it instead of swapping.';
  if (reserveIndex !== undefined && state.reserveIndividuals[reserveIndex]?.name !== incoming.name) {
    return "That reserve isn't on the list any more.";
  }
  if (incoming.name.trim().toLowerCase() === outgoing.name.trim().toLowerCase()) {
    return `"${outgoing.name}" is already in that slot.`;
  }
  return nameRefusal(state, incoming.name, outgoing.name, reserveIndex);
}

/**
 * Takes a team's hand absent mark (One score per team) on this slot back in the round in play: the newcomer is not
 * the person who was absent. Answers to scored 0s are left alone.
 */
function withoutSlotMarks(state: TournamentState, teamId: string, memberIndex: number): TournamentState {
  const { start, end } = currentColumn(state);
  let next = state;
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    const seated = state.assignments[roundIndex] ?? [];
    for (const entry of seated) {
      if (entry.name !== teamId || entry.room === null) continue;
      const position = seated.filter((other) => other.room === entry.room).indexOf(entry);
      next = unmarkOneScoreTeamMemberAbsent(next, roundIndex, entry.room, position, memberIndex);
    }
  }
  return next;
}

/**
 * Puts `incoming` in the slot of a team member, in any round and before the start. The member who goes out becomes
 * an individual reserve (and can be swapped back); the newcomer leaves the individual reserves when they came from
 * there. Scores, confirmations and the defender stay with the slot and the names they were stored under.
 */
export function swapTeamMember(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  incoming: TeamMember,
  reserveIndex?: number,
): TournamentState {
  if (memberSwapRefusal(state, teamId, memberIndex, incoming, reserveIndex)) return state;
  const outgoing = teamOf(state, teamId)?.members[memberIndex];
  if (!outgoing) return state;
  const name = incoming.name.trim();
  const newcomer: TeamMember = incoming.userId ? { name, userId: incoming.userId } : { name };
  const swapped = updateTeam(state, teamId, (team) => ({
    ...team,
    members: team.members.map((member, index) => (index === memberIndex ? newcomer : member)),
  }));
  if (swapped === state) return state;
  return withoutSlotMarks(
    {
      ...swapped,
      reserveIndividuals: [
        ...swapped.reserveIndividuals.filter((_, index) => index !== reserveIndex),
        outgoing,
      ],
    },
    teamId,
    memberIndex,
  );
}

/** Why a vacant slot can't be filled with this player, or null: the slot must be vacant and the name free (a reserve taken from the list does not count against itself). */
export function slotFillRefusal(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  member: TeamMember,
  reserveIndex?: number,
): string | null {
  const team = teamOf(state, teamId);
  if (!team) return "That team isn't in the tournament.";
  if (team.members[memberIndex]) return 'That slot is already filled — swap the member instead.';
  if (reserveIndex !== undefined && state.reserveIndividuals[reserveIndex]?.name !== member.name) {
    return "That reserve isn't on the list any more.";
  }
  return nameRefusal(state, member.name, undefined, reserveIndex);
}

/**
 * Fills a vacant slot of a team, at any time: like a member swap it changes no schedule, so no reserve window
 * applies. The player comes from the individual reserves (`reserveIndex`) or is a new name.
 */
export function fillTeamSlot(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  member: TeamMember,
  reserveIndex?: number,
): TournamentState {
  if (slotFillRefusal(state, teamId, memberIndex, member, reserveIndex)) return state;
  const name = member.name.trim();
  const newcomer: TeamMember = member.userId ? { name, userId: member.userId } : { name };
  const filled = updateTeam(state, teamId, (team) => ({
    ...team,
    members: team.members.map((entry, index) => (index === memberIndex ? newcomer : entry)),
  }));
  if (filled === state) return state;
  return {
    ...filled,
    reserveIndividuals: filled.reserveIndividuals.filter((_, index) => index !== reserveIndex),
  };
}
