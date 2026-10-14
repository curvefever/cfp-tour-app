import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { getDefenderIndex, scoredTeamSize } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

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

/** The sum of one member's scores over the round's games; null when the member has none. */
function memberTotal(
  state: TournamentState,
  roundIndex: number,
  seat: { room: number; position: number },
  memberIndex: number,
): number | null {
  const games = state.rounds[roundIndex]?.numGames ?? 1;
  let total: number | null = null;
  for (let game = 1; game <= games; game += 1) {
    const suffix = games > 1 ? `-g${game}` : '';
    const value = state.scores[`r${roundIndex}-rm${seat.room}-p${seat.position}${suffix}-m${memberIndex}`];
    if (typeof value === 'number') total = (total ?? 0) + value;
  }
  return total;
}

/**
 * The line under a team's name in a room: its members joined with " · ", the designated defender marked, and
 * with each member's own score after the name when `seat` is given (the room is complete) and the team scoring
 * rule scores members one by one. Survival Teams scores one number per team, so it shows names only.
 */
export function teamMemberLine(
  state: TournamentState,
  name: string,
  roundIndex: number,
  seat: { room: number; position: number } | null = null,
): string {
  const info = unitDisplay(state, name);
  if (!info.members?.length) return '';
  const team = buildTeamMap(state)[name];
  const withScores = seat !== null && scoredTeamSize(state) !== undefined;
  return info.members
    .map((member, index) => {
      const found = team?.members.findIndex((entry) => entry?.name === member) ?? -1;
      const rawIndex = found === -1 ? index : found;
      const label = memberLabel(state, name, roundIndex, rawIndex, member);
      const total = withScores ? memberTotal(state, roundIndex, seat, rawIndex) : null;
      return total === null ? label : `${label} ${total}`;
    })
    .join(' · ');
}
