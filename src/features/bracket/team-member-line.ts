import { isMarkedAbsent, isMemberMarkedAbsent, survivalMemberKey } from '../../domain/tournament/absences';
import { countedGames } from '../../domain/tournament/match-format';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { getDefenderIndex, scoreKeysForPosition, scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { joinMembers } from '../tournament/components/member-line';

/** A member's name, with a shield after the designated defender's (Save your Buddy). */
export function memberLabel(
  state: TournamentState,
  name: string,
  roundIndex: number,
  rawIndex: number,
  memberName: string,
) {
  const defender =
    state.gamemodeConfig.teamScoringRule === 'designated-player' &&
    getDefenderIndex(state, name, roundIndex) === rawIndex;
  return `${memberName}${defender ? ' 🛡' : ''}`;
}

/** The sum of one member's scores over the games that count (a decided Best-of room leaves the rest out); null when the member has none. */
function memberTotal(
  state: TournamentState,
  roundIndex: number,
  seat: { room: number; position: number },
  memberIndex: number,
  teamSize: number,
): number | null {
  const numGames = state.rounds[roundIndex]?.numGames ?? 1;
  // The keys come game by game, each game holding one key per member.
  const keys = scoreKeysForPosition({
    roundIndex,
    room: seat.room,
    position: seat.position,
    numGames,
    teamSize,
  });
  let total: number | null = null;
  for (let game = 0; game < Math.min(numGames, countedGames(state, roundIndex, seat.room)); game += 1) {
    const value = state.scores[keys[game * teamSize + memberIndex]];
    if (typeof value === 'number') total = (total ?? 0) + value;
  }
  return total;
}

/** Whether the member was absent in every game that counts (sum of members, Save your Buddy). */
function memberAbsent(
  state: TournamentState,
  roundIndex: number,
  seat: { room: number; position: number },
  memberIndex: number,
  teamSize: number,
): boolean {
  const numGames = state.rounds[roundIndex]?.numGames ?? 1;
  const keys = scoreKeysForPosition({
    roundIndex,
    room: seat.room,
    position: seat.position,
    numGames,
    teamSize,
  });
  const counted = Math.max(Math.min(numGames, countedGames(state, roundIndex, seat.room)), 1);
  return Array.from({ length: counted }, (_, game) => keys[game * teamSize + memberIndex]).every((key) =>
    isMarkedAbsent(state, key),
  );
}

/**
 * The line under a team's name in a room: its members joined with " · " (`joinMembers`, which wraps only between members), the designated defender marked, and
 * with each member's own score after the name when `seat` is given (the room is complete) and the team scoring
 * rule scores members one by one, or "ABS" for a member who was absent. Survival Teams scores one number per team, so
 * it shows names only, and "absent" after a member the organiser marked by hand (`seat`, or `markSeat` before the room is complete).
 */
export function teamMemberLine(
  state: TournamentState,
  name: string,
  roundIndex: number,
  seat: { room: number; position: number } | null = null,
  markSeat: { room: number; position: number } | null = seat,
): string {
  const info = unitDisplay(state, name);
  if (!info.members?.length) return '';
  const team = buildTeamMap(state)[name];
  const teamSize = scoredTeamSize(state);
  const members = info.members.map((member, index) => {
    const found = team?.members.findIndex((entry) => entry?.name === member) ?? -1;
    const rawIndex = found === -1 ? index : found;
    const label = memberLabel(state, name, roundIndex, rawIndex, member);
    if (
      seat !== null &&
      teamSize !== undefined &&
      memberAbsent(state, roundIndex, seat, rawIndex, teamSize)
    ) {
      return `${label} ABS`;
    }
    if (
      markSeat !== null &&
      teamSize === undefined &&
      isMemberMarkedAbsent(state, survivalMemberKey(roundIndex, markSeat.room, markSeat.position, rawIndex))
    ) {
      return `${label} absent`;
    }
    const total =
      seat !== null && teamSize !== undefined
        ? memberTotal(state, roundIndex, seat, rawIndex, teamSize)
        : null;
    return total === null ? label : `${label} ${total}`;
  });
  return joinMembers(members);
}
