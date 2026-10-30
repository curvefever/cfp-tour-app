import type {
  GameFormatDefinition,
  GameFormatKey,
  OddCountStrategyKey,
  PoolingPhaseKey,
  RoomSize,
  ScheduleLogicKey,
  TournamentState,
} from './types';

/** The game's hard cap on players in one room; no format may seat more. */
export const HARD_ROOM_PLAYER_CAP = 10;

export const TEAM_SIZES: readonly number[] = [2, 3, 4, 5];
const MAX_TEAMS_PER_ROOM = 5;

/** The teams-per-room counts that make a valid format for this team size: 2 up to what the room cap and the maximum allow. */
export function teamsPerRoomOptions(teamSize: number): number[] {
  const largest = Math.min(MAX_TEAMS_PER_ROOM, Math.floor(HARD_ROOM_PLAYER_CAP / teamSize));
  return Array.from({ length: Math.max(0, largest - 1) }, (_unused, index) => index + 2);
}

/** "2v2v2" for 3 teams of 2: `teamsPerRoom` copies of `teamSize` joined by "v". */
export function teamFormatLabel(teamSize: number, teamsPerRoom: number): string {
  return Array.from({ length: teamsPerRoom }, () => teamSize).join('v');
}

export function teamFormatKey(teamSize: number, teamsPerRoom: number): GameFormatKey {
  return `team-${teamFormatLabel(teamSize, teamsPerRoom)}`;
}

/**
 * One team format from the rule. Several teams per room: rooms hold from one
 * team fewer up to the full count. Two teams: head-to-head, where Flex (one
 * 3-team room) is offered only if three teams still fit the player cap.
 */
function buildTeamFormat(teamSize: number, teamsPerRoom: number): Readonly<GameFormatDefinition> {
  const label = teamFormatLabel(teamSize, teamsPerRoom);
  const common = {
    key: teamFormatKey(teamSize, teamsPerRoom),
    label,
    shortLabel: label,
    unitLabel: 'Team',
    unitLabelPlural: 'Teams',
    teamSize,
    teamsPerRoom,
  } as const;
  if (teamsPerRoom >= 3) {
    return {
      ...common,
      defaultRoomSize: { min: teamsPerRoom - 1, max: teamsPerRoom, ideal: teamsPerRoom },
    };
  }
  const flexFits = 3 * teamSize <= HARD_ROOM_PLAYER_CAP;
  return {
    ...common,
    idealRoomSize: 2,
    supportedOddCountStrategies: flexFits ? ['none', 'bye', 'flex'] : ['none', 'bye'],
    defaultOddCountStrategy: 'bye',
  };
}

const TEAM_FORMATS = TEAM_SIZES.flatMap((teamSize) =>
  teamsPerRoomOptions(teamSize).map((teamsPerRoom) => buildTeamFormat(teamSize, teamsPerRoom)),
);

const INDIVIDUAL_FORMATS: Array<Readonly<GameFormatDefinition>> = [
  {
    key: 'ffa-individual',
    label: 'FFA',
    shortLabel: 'FFA',
    unitLabel: 'Player',
    unitLabelPlural: 'Players',
    defaultRoomSize: { min: 6, max: 8, ideal: 8 },
  },
  {
    key: 'individual-1v1',
    label: '1v1',
    shortLabel: '1v1',
    unitLabel: 'Player',
    unitLabelPlural: 'Players',
    idealRoomSize: 2,
    supportedOddCountStrategies: ['none', 'bye'],
    defaultOddCountStrategy: 'bye',
  },
];

/** Every format Setup offers, in display order. */
export const GAME_FORMAT_LIST: ReadonlyArray<Readonly<GameFormatDefinition>> = [
  ...INDIVIDUAL_FORMATS,
  ...TEAM_FORMATS,
];

export const GAME_FORMATS: Readonly<Partial<Record<GameFormatKey, Readonly<GameFormatDefinition>>>> =
  Object.fromEntries(GAME_FORMAT_LIST.map((format) => [format.key, format]));

/** Stored value, kept as first named; the rule is "One score per team". */
export const ONE_SCORE_PER_TEAM = 'survival-teams' as const;

/** Whether the tournament scores its teams by one score per team (not per member). */
export function isOneScorePerTeam(state: Pick<TournamentState, 'gamemodeConfig'>): boolean {
  return state.gamemodeConfig.teamScoringRule === ONE_SCORE_PER_TEAM;
}

export const TEAM_SCORING_RULE_LABELS = {
  'sum-members': 'Sum of all members',
  'designated-player': 'Save your Buddy (defender only)',
  [ONE_SCORE_PER_TEAM]: 'One score per team',
} as const;

export const ODD_COUNT_STRATEGY_LABELS = {
  none: 'None — strict, refuse to generate on an odd count',
  bye: 'Bye — a team can sit out a round when needed',
  flex: 'Flex — a room can occasionally hold one extra team',
} as const;

export const SCHEDULE_LOGIC_LABELS: Record<ScheduleLogicKey, string> = {
  'single-elimination': 'Single elimination',
  'double-elimination': 'Double elimination',
  'double-elimination-shared-final': 'Double elimination — FFA/Team',
  'kings-valley': 'Kings Valley',
  'waterfall-bracket': 'Custom bracket (organiser-authored)',
};

export const POOLING_PHASE_LABELS: Record<PoolingPhaseKey, string> = {
  none: 'None — standard elimination from R1',
  'qual-table': 'Qualification Table',
  swiss: 'Swiss',
  'group-stage': 'Group Stage',
};

export function getGameFormat(key: GameFormatKey): Readonly<GameFormatDefinition> | undefined {
  return GAME_FORMATS[key];
}

/** The format's plural unit ("teams", "players") for running text; "players" when the format is unknown. */
export function unitLabelPluralLower(key: GameFormatKey | undefined): string {
  return (key ? getGameFormat(key)?.unitLabelPlural : undefined)?.toLowerCase() ?? 'players';
}

/**
 * The odd-count strategy a format actually applies: the chosen one, or the
 * format's default when unset (""), or undefined for formats without odd-count
 * options. Setup's display and generation both go through this, so what is
 * shown is what is applied.
 */
export function resolveOddCountStrategy(
  format: Readonly<GameFormatDefinition>,
  value: OddCountStrategyKey | '' | undefined,
): OddCountStrategyKey | undefined {
  if (!format.supportedOddCountStrategies?.length) return undefined;
  return value || format.defaultOddCountStrategy;
}

export function deriveRoomSize(
  format: Readonly<GameFormatDefinition>,
  oddCountStrategy?: OddCountStrategyKey,
): RoomSize {
  if (format.defaultRoomSize) return { ...format.defaultRoomSize };
  const ideal = format.idealRoomSize;
  if (ideal === undefined) {
    throw new Error(`Format ${format.key} has no room-size definition.`);
  }
  if (oddCountStrategy === 'flex') {
    return { min: ideal, max: ideal + 1, ideal };
  }
  return { min: ideal, max: ideal, ideal };
}
