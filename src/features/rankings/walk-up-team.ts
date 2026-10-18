import { parseTeamLines } from '../../domain/tournament/roster';
import type { IdSource } from '../../domain/tournament/runtime';
import type { TournamentTeam } from '../../domain/tournament/types';

export type WalkUpTeamParse =
  | { status: 'empty' }
  | { status: 'no-members'; message: string }
  | { status: 'parsed'; team: TournamentTeam };

/** Why a team can't be added without a player. */
export function noMembersMessage(teamName: string): string {
  return `"${teamName}" has no players listed — add at least one member.`;
}

/** "Player1, Player2": the member slots of a team line, for placeholders and prompts. */
export function memberPlaceholders(teamSize: number): string {
  return Array.from({ length: teamSize }, (_, index) => `Player${index + 1}`).join(', ');
}

/** One typed line in the roster format (`TeamName, Player1, Player2`) as a brand-new walk-up team. */
export function parseWalkUpTeam(line: string, teamSize: number, ids: IdSource): WalkUpTeamParse {
  if (!line.trim()) return { status: 'empty' };
  const [team] = parseTeamLines({ value: line, idPrefix: 'team', teamSize, ids });
  if (!team) return { status: 'empty' };
  if (team.members.every((member) => !member)) {
    return { status: 'no-members', message: noMembersMessage(team.teamName) };
  }
  return { status: 'parsed', team };
}
