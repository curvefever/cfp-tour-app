import {
  isMarkedAbsent,
  isMemberMarkedAbsent,
  oneScoreTeamMemberKey,
} from '../../domain/tournament/absences';
import { countedGames } from '../../domain/tournament/match-format';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import {
  getDefenderIndex,
  scoreKeysForPosition,
  scoredMemberSlots,
  scoredTeamSize,
} from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { NO_BREAK_SPACE } from '../tournament/components/member-line';

/** Whether the member in this slot is the team's designated defender in this round (Save your Buddy). */
export function isDesignatedDefender(
  state: TournamentState,
  name: string,
  roundIndex: number,
  rawIndex: number,
): boolean {
  return (
    state.gamemodeConfig.teamScoringRule === 'designated-player' &&
    getDefenderIndex(state, name, roundIndex) === rawIndex
  );
}

/** One member in the line under a team's name: the name, whether it gets the defender's shield, and what follows it (a score, "ABS", "absent"), with no-break spaces. */
export type MemberPart = { name: string; defender: boolean; after: string };

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

/**
 * Whether the member was absent in every game that counts. A member whose own score is entered is absent when that score
 * is; a member who takes none (a teammate of the defender in Save your Buddy) is absent when the team is, that is,
 * when the scores that are entered are.
 */
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
  const unit = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === seat.room)[
    seat.position
  ];
  const slots = scoredMemberSlots(state, unit?.name, roundIndex, teamSize);
  const asked = slots.includes(memberIndex) ? [memberIndex] : slots;
  return Array.from({ length: counted }, (_, game) => game).every((game) =>
    asked.every((slot) => isMarkedAbsent(state, keys[game * teamSize + slot])),
  );
}

/**
 * The members in the line under a team's name in a room (`TeamMembers` joins them with " · ", wrapping only between members): the designated defender marked, and
 * with each member's own score after the name when `seat` is given (the room is complete) and the team scoring
 * rule scores members one by one, or "ABS" for a member who was absent. One score per team scores one number per team,
 * and Save your Buddy one number from the defender, which the row shows as the team's score, so both show names only, and "absent" after a member the organiser marked by hand (`seat`, or `markSeat` before the room is complete).
 */
export function teamMemberParts(
  state: TournamentState,
  name: string,
  roundIndex: number,
  seat: { room: number; position: number } | null = null,
  markSeat: { room: number; position: number } | null = seat,
): MemberPart[] {
  const info = unitDisplay(state, name);
  if (!info.members?.length) return [];
  const team = buildTeamMap(state)[name];
  const teamSize = scoredTeamSize(state);
  // Save your Buddy: the defender's score is the team's, shown on the right of the row, not after the name.
  const everyMemberScored =
    teamSize !== undefined && scoredMemberSlots(state, name, roundIndex, teamSize).length === teamSize;
  return info.members.map((member, index) => {
    const found = team?.members.findIndex((entry) => entry?.name === member) ?? -1;
    const rawIndex = found === -1 ? index : found;
    const part = (after: string): MemberPart => ({
      name: member.replaceAll(' ', NO_BREAK_SPACE),
      defender: isDesignatedDefender(state, name, roundIndex, rawIndex),
      after: after ? `${NO_BREAK_SPACE}${after}` : '',
    });
    if (
      seat !== null &&
      teamSize !== undefined &&
      memberAbsent(state, roundIndex, seat, rawIndex, teamSize)
    ) {
      return part('ABS');
    }
    if (
      markSeat !== null &&
      teamSize === undefined &&
      isMemberMarkedAbsent(
        state,
        oneScoreTeamMemberKey(roundIndex, markSeat.room, markSeat.position, rawIndex),
      )
    ) {
      return part('absent');
    }
    const total =
      seat !== null && teamSize !== undefined && everyMemberScored
        ? memberTotal(state, roundIndex, seat, rawIndex, teamSize)
        : null;
    return part(total === null ? '' : String(total));
  });
}
