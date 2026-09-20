export type ActiveTab = 'admin' | 'scoreboard' | 'bracket' | 'rankings' | 'archive';

export type GameFormatKey =
  'ffa-individual' | 'team-2v2v2v2' | 'team-3v3v3' | 'team-3v3' | 'last-man-standing' | 'individual-1v1';

export type ImplementedGameFormatKey = Exclude<GameFormatKey, 'last-man-standing'>;

export type ScheduleLogicKey =
  'single-elimination' | 'double-elimination' | 'double-elimination-shared-final' | 'kings-valley';

export type PoolingPhaseKey = 'none' | 'qual-table' | 'swiss' | 'group-stage';

export type ScoringSystemKey = 'fairpoints' | 'positional-points';
export type OddCountStrategyKey = 'none' | 'bye' | 'flex';
export type TeamScoringRuleKey = 'sum-members' | 'designated-player';
export type RoundRobinMode = 'single' | 'double';
export type BracketKey = 'winners' | 'losers' | 'grand-final';

export interface TeamMember {
  name: string;
  userId?: string;
}

export interface TournamentTeam {
  teamId: string;
  teamName: string;
  members: Array<TeamMember | null>;
}

export type TournamentRoster = string[] | TournamentTeam[];

export interface RoomSize {
  min: number;
  max: number;
  ideal: number;
}

export interface GameFormatDefinition {
  key: ImplementedGameFormatKey;
  label: string;
  unitLabel: 'Player' | 'Team';
  unitLabelPlural: 'Players' | 'Teams';
  teamSize?: number;
  defaultRoomSize?: RoomSize;
  idealRoomSize?: number;
  supportedOddCountStrategies?: OddCountStrategyKey[];
}

export interface GroupStageMatch {
  group: string;
  pair: [string, string];
}

export interface TournamentRound {
  roundNum: number;
  players: number;
  rooms: number[];
  byeCount: number;
  isQual: boolean;
  isNoElim: boolean;
  isSemis: boolean;
  isFinal: boolean;
  advPerRoom: number | null;
  advTotal: number;
  luckyCount: number;
  isSwiss?: boolean;
  pairingTBD?: boolean;
  /** Played and used to seed the next round, but excluded from the cumulative qualification/Swiss standings (materializeStandings, advancement.ts). Set on a pooling phase's own leading rounds at generation time -- never toggled mid-tournament. */
  excludeFromStandings?: boolean;
  isGroupStage?: boolean;
  roomGroups?: string[];
  matches?: GroupStageMatch[];
  groupByes?: string[];
  numGames?: number;
  bracket?: BracketKey;
  winnersTo?: number | null;
  losersTo?: number | null;
  bracketPhaseFirstRound?: boolean;
  wbFinalistName?: string;
  isKingsValley?: boolean;
  kvPromoteCounts?: number[];
  kvDemoteCounts?: number[];
  kvEliminateCount?: number;
  /** 1-indexed game numbers of this round (only ever meaningful on the Final) scored under a temporary placeholder name -- see TournamentState.anonymousFinalists. */
  anonymousGames?: number[];
  /** Organiser-supplied fixed reseed mode for THIS round's own advancement into the next round, overriding the automatic diversity/balance taper (tieredSeed/tieredBracketSeed, seeding.ts). WB elimination rounds only (single-elimination / double-elimination-shared-final's WB-to-WB transitions) -- see generation.ts's eliminationSeedingOverrides. */
  seedingOverride?: 'diversity' | 'balance' | 'random';
}

export interface RoundAssignment {
  name: string;
  room: number | null;
  isLucky?: boolean;
}

/**
 * A Final-round game slot scored under a temporary placeholder name instead
 * of the real finalist's, per TournamentRound.anonymousGames. Generated once
 * (in finalist order, from that round's own assignments) the first time any
 * of that Final's games is flagged anonymous, then held stable across every
 * subsequently-flagged game in the same Final.
 */
export interface AnonymousFinalist {
  alias: string;
  realKey: string;
  connected: boolean;
}

/**
 * A double-elimination route before it is assigned to a physical room.
 * `tierRank`/`pct` are tagged once, at the moment this entry is pushed onto
 * `pendingBracketSeeds` (see `advanceDoubleElimination` in transitions.ts) --
 * the same room-rank-position signal `buildAdvancementTiers` derives for the
 * generic reseeding path, captured here because a target round's pool can
 * accumulate from more than one source round, by which point there is no
 * single round left to re-derive it from.
 */
export interface PendingBracketSeed {
  name: string;
  isLucky?: boolean;
  tierRank: number;
  pct: number;
}

export interface TournamentStanding {
  name: string;
  totalFP: number | null;
  totalScore: number;
  played: number;
}

export interface TournamentGroup {
  label: string;
  members: string[];
}

export interface DefenderChange {
  round: number;
  memberIdx: number;
}

/**
 * A roster unit removed or swapped out mid-tournament. Snapshotted at the
 * moment of departure (via unitDisplay(), before the unit is stripped from
 * state.players) -- for a team, the live TournamentTeam object backing its
 * display name is gone once removed, so there's nothing left in state to
 * re-derive `label`/`members` from afterward.
 */
export interface WithdrawnUnit {
  name: string;
  label: string;
  members: string[] | null;
  playedAnyMatch: boolean;
  reason: 'removed' | 'swapped';
}

export interface GeneratedTournamentConfig {
  n: number;
  poolingPhase: PoolingPhaseKey;
  qualAdv: number;
  groupSize: number;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: number;
  scoring: ScoringSystemKey;
  finalsGames: number;
  semisGames: number;
}

export interface MaterializedGamemodeConfig {
  qualRounds: number;
  swissRounds: number;
  /** How many of the qual-table/Swiss phase's own leading rounds are played but excluded from the cumulative standings (see TournamentRound.excludeFromStandings). 0 = every round counts. */
  nonCountingRounds: number;
  teamScoringRule: TeamScoringRuleKey;
  oddCountStrategy?: OddCountStrategyKey;
  roomSize: RoomSize;
  semisSize: number;
  finalSize: number;
  scoring: ScoringSystemKey;
  /** Organiser-supplied rank->points table (highest rank first), only present when scoring === 'positional-points'. See generation.ts for validation. */
  positionalPointsTable?: number[];
  lbQualifiers?: number;
  /** Organiser-supplied ordered WB elimination-round survivor-count targets (single-elimination / double-elimination-shared-final only). Replaces the automatic geometric-decay curve entirely when set. */
  explicitTargets?: number[];
  /** Organiser-supplied fixed reseed mode per WB elimination round, index-aligned with explicitTargets. Only valid alongside explicitTargets -- see generation.ts. */
  explicitSeedingOverrides?: Array<'diversity' | 'balance' | 'random' | undefined>;
  poolingPhase: PoolingPhaseKey;
  bracketPhase: ScheduleLogicKey;
  finalsGames: number;
  semisGames: number;
  grandFinalWbTarget: number;
  grandFinalLbTarget: number;
  groupSize: number;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: number;
}

export interface TournamentState {
  title: string;
  players: TournamentRoster;
  reserves: TournamentRoster;
  reserveIndividuals: TeamMember[];
  confirmedCount: number | null;
  tournamentId: string | null;
  rounds: TournamentRound[];
  curRound: number;
  scores: Record<string, number | null>;
  finalScores: Record<string, number | '' | null>;
  assignments: RoundAssignment[][];
  luckyLosers: string[][];
  byes: string[][];
  poolingByeCounts: Record<string, number>;
  /** Canonical pair-key (seeding.ts's roomPairKey) -> round index of that pair's most recent shared room. Written only by the ordinary room-based reseed path (tieredSeed/recordRoomHistory), read for round-to-round rematch avoidance. */
  roomHistory: Record<string, number>;
  pendingBracketSeeds: Record<string, PendingBracketSeed[]>;
  qualTable: TournamentStanding[];
  groups: TournamentGroup[];
  groupStandings: Record<string, TournamentStanding[]>;
  tieResolutions: Record<string, string | string[]>;
  defenderChanges: Record<string, DefenderChange[]>;
  withdrawnUnits: WithdrawnUnit[];
  /** The Final's placeholder roster, generated once a Final game is first flagged anonymous (see TournamentRound.anonymousGames) and held stable across the rest of that Final. */
  anonymousFinalists: AnonymousFinalist[];
  reserveOpen: boolean;
  started: boolean;
  needsSave: boolean;
  autoSaved: boolean;
  cfg: Partial<GeneratedTournamentConfig>;
  scheduleLogic: ScheduleLogicKey;
  gameFormat: GameFormatKey;
  gamemodeConfig: Partial<MaterializedGamemodeConfig>;
}

export interface PersistedSetup {
  scheduleLogic: ScheduleLogicKey;
  gameFormat: GameFormatKey;
  scoring: ScoringSystemKey;
  /** Comma-separated rank->points table (highest rank first), e.g. "10,8,6,5,4,3,2,1". Only read when scoring === 'positional-points'. */
  positionalPointsTable: string;
  poolingPhase: PoolingPhaseKey;
  qualAdv: string;
  nonCountingRounds: string;
  groupSize: string;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: string;
  finalsGames: string;
  semisGames: string;
  grandFinalWbTarget: string;
  grandFinalLbTarget: string;
  semisOverride: string;
  finalOverride: string;
  qualRoundsOverride: string;
  swissRoundsOverride: string;
  eliminationRoundTargets: string;
  eliminationSeedingOverrides: string;
  oddCountStrategy: OddCountStrategyKey | '';
  teamScoringRule: TeamScoringRuleKey | '';
  roster: string;
  reserves: string;
  reserveIndividuals: string;
  /** Compatibility field used by saves from before poolingPhase existed. */
  qual?: 'yes' | 'no';
}

export interface PersistedTournamentEnvelope {
  T: TournamentState;
  setup: PersistedSetup;
  activeTab: ActiveTab;
}
