import {
  TEAM_SIZES,
  getGameFormat,
  teamFormatKey,
  teamFormatLabel,
  teamsPerRoomOptions,
} from '../../../domain/tournament/formats';
import type { GameFormatKey, PersistedSetup } from '../../../domain/tournament/types';

/** The three kinds of game format Setup offers; the team kind is refined by players per team and teams per room. */
export type FormatKind = 'ffa' | '1v1' | 'teams';

export const FORMAT_KIND_LABELS: Record<FormatKind, string> = {
  ffa: 'FFA — Individual',
  '1v1': '1v1',
  teams: 'Teams',
};

/** What Setup selects on switching to Teams: the team format played most so far. */
const DEFAULT_TEAM_FORMAT: GameFormatKey = teamFormatKey(2, 4);

const KIND_KEYS: Record<Exclude<FormatKind, 'teams'>, GameFormatKey> = {
  ffa: 'ffa-individual',
  '1v1': 'individual-1v1',
};

export function formatKind(key: GameFormatKey): FormatKind {
  if (getGameFormat(key)?.teamSize) return 'teams';
  return key === KIND_KEYS['1v1'] ? '1v1' : 'ffa';
}

export function keyForKind(kind: FormatKind): GameFormatKey {
  return kind === 'teams' ? DEFAULT_TEAM_FORMAT : KIND_KEYS[kind];
}

export interface TeamShape {
  teamSize: number;
  teamsPerRoom: number;
}

/** The players per team and teams per room of a team format; the default shape for any other key. */
export function teamShape(key: GameFormatKey): TeamShape {
  const format = getGameFormat(key);
  if (format?.teamSize && format.teamsPerRoom) {
    return { teamSize: format.teamSize, teamsPerRoom: format.teamsPerRoom };
  }
  return { teamSize: 2, teamsPerRoom: 4 };
}

/** The format after changing players per team: teams per room stays when still valid, else the largest valid count. */
export function keyAfterTeamSizeChange(key: GameFormatKey, teamSize: number): GameFormatKey {
  const valid = teamsPerRoomOptions(teamSize);
  const { teamsPerRoom } = teamShape(key);
  const kept = valid.includes(teamsPerRoom) ? teamsPerRoom : valid[valid.length - 1];
  return teamFormatKey(teamSize, kept);
}

export function keyAfterTeamsPerRoomChange(key: GameFormatKey, teamsPerRoom: number): GameFormatKey {
  return teamFormatKey(teamShape(key).teamSize, teamsPerRoom);
}

export interface NumberChoice {
  value: number;
  label: string;
}

/** The "Players per team" options: 2 to 5. */
export function teamSizeChoices(): NumberChoice[] {
  return TEAM_SIZES.map((size) => ({ value: size, label: String(size) }));
}

/** The "Teams per room" options valid for a team size, each with the format it makes: "2 (4v4)". */
export function teamsPerRoomChoices(teamSize: number): NumberChoice[] {
  return teamsPerRoomOptions(teamSize).map((count) => ({
    value: count,
    label: `${count} (${teamFormatLabel(teamSize, count)})`,
  }));
}

/** The team scoring rule after a format change: kept between two team formats, "Sum of all members" when entering teams, none otherwise. */
export function nextTeamScoringRule(
  current: Pick<PersistedSetup, 'gameFormat' | 'teamScoringRule'>,
  nextTeamSize: number | undefined,
): PersistedSetup['teamScoringRule'] {
  if (!nextTeamSize) return '';
  const wasTeams = getGameFormat(current.gameFormat)?.teamSize !== undefined;
  return (wasTeams && current.teamScoringRule) || 'sum-members';
}
