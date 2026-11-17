/**
 * The people who showed up (Rankings' "Copy players"): each player that played a match, once, in natural alphabetical
 * order. Individual formats list the players, a team format its members, never the team names.
 */
import { hasPlayedAnyMatch, membersPresentAtSeat, playedTheFinal } from './absences';
import { getGameFormat } from './formats';
import { rosterKeys } from './roster';
import type { TournamentState, TournamentTeam } from './types';

/** The slots of a unit's members that showed up at any seat of the unit in a room round (the Final is read apart). */
function slotsPresentInRooms(state: TournamentState, unit: string): Set<number> {
  const slots = new Set<number>();
  state.assignments.forEach((entries, roundIndex) => {
    if (state.rounds[roundIndex]?.isFinal) return;
    const seated = entries.filter((entry) => entry.room !== null);
    seated.forEach((entry, index) => {
      if (entry.name !== unit || entry.room === null) return;
      const position = seated.slice(0, index).filter((other) => other.room === entry.room).length;
      for (const slot of membersPresentAtSeat(state, roundIndex, entry.room, position)) slots.add(slot);
    });
  });
  return slots;
}

/**
 * The members of a team that played: every member when the team played the Final (its 0s are never asked), else the
 * ones that showed up at a seat of the team. `members` are the slots in order (a vacant slot is null).
 */
function membersWhoPlayed(state: TournamentState, unit: string, members: Array<string | null>): string[] {
  const slots = playedTheFinal(state, unit) ? null : slotsPresentInRooms(state, unit);
  return members.flatMap((name, slot) =>
    name !== null && (slots === null || slots.has(slot)) ? [name] : [],
  );
}

function teamWhoPlayed(state: TournamentState, team: TournamentTeam): string[] {
  if (!hasPlayedAnyMatch(state, team.teamId)) return [];
  return membersWhoPlayed(
    state,
    team.teamId,
    team.members.map((member) => member?.name ?? null),
  );
}

/** The people who played, from the roster and from the units that left it after playing (removed or swapped out). */
function unsortedPlayers(state: TournamentState): string[] {
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const left = state.withdrawnUnits.filter((unit) => unit.playedAnyMatch);
  if (!teamSize) {
    const current = rosterKeys(state.players).filter((name) => hasPlayedAnyMatch(state, name));
    return [...current, ...left.map((unit) => unit.name)];
  }
  const current = (state.players as TournamentTeam[]).flatMap((team) => teamWhoPlayed(state, team));
  // A team that left the roster keeps its members as they were (a vacant slot was dropped), so slot numbers are theirs.
  return [...current, ...left.flatMap((unit) => membersWhoPlayed(state, unit.name, unit.members ?? []))];
}

/** The names of the people who played, no duplicates, in natural alphabetical order ("Player 9" before "Player 10"). */
export function playersWhoPlayed(state: TournamentState): string[] {
  return [...new Set(unsortedPlayers(state))].sort((first, second) =>
    first.localeCompare(second, undefined, { numeric: true }),
  );
}
