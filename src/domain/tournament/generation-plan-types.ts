import type { MatchResultPoints } from './match-results';
import type { matchFormatConfig } from './round-match-formats';
import type {
  GameFormatDefinition,
  GeneratedTournamentConfig,
  MaterializedGamemodeConfig,
  OddCountStrategyKey,
  OrderedWaterfallGraph,
  PersistedSetup,
  RoomSize,
  ScheduleLogicKey,
} from './types';

export interface GenerationForm extends PersistedSetup {
  /** A setting kept out of PersistedSetup, the stored shape of the Setup form. */
  lbQualifiers?: string;
}

/** What generation works with: the stored `cfg` plus the settings it reads here and keeps in `gamemodeConfig` only. */
export type GenerationConfig = GeneratedTournamentConfig &
  Pick<MaterializedGamemodeConfig, 'scoring' | 'drawPublication' | 'finalsGames' | 'semisGames'>;

/** What a step of the plan answers: the plan with its fields added, or the refusal the organiser reads. */
export type Planned<T> = { ok: true; plan: T } | { ok: false; message: string };

export function refuse(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

export interface PlanAfterRoster {
  unitCount: number;
  format: Readonly<GameFormatDefinition>;
  /** The Setup form's schedule logic. */
  chosen: ScheduleLogicKey;
  /** The bracket phase it is generated as. */
  schedule: ScheduleLogicKey;
  /** The format's room size with no odd-count strategy applied. */
  formatRoomSize: RoomSize;
  floorMin: number;
  unitPlural: string;
}

export interface PlanAfterPoolingSettings extends PlanAfterRoster {
  matchConfig: ReturnType<typeof matchFormatConfig>;
  config: GenerationConfig;
}

export interface PlanAfterBracketShape extends PlanAfterPoolingSettings {
  oddCountStrategy: OddCountStrategyKey | undefined;
  roomSize: RoomSize;
  /** The Custom bracket text to build from: the form's, or the one derived from the head count. */
  graphText: string;
  /** The number who play a layered bracket's plan was made for. */
  layeredPlay: number | undefined;
  waterfallGraph: OrderedWaterfallGraph | undefined;
  /** The graph is fed by the final standings of a qualification table or a Swiss. */
  graphHasQualSource: boolean;
  /** The graph is fed by the group exit order. */
  graphHasGroupsSource: boolean;
}

export interface PlanAfterPoolingRounds extends PlanAfterBracketShape {
  qualRounds: number;
  swissRounds: number;
  nonCountingRounds: number;
}

export interface PlanAfterBracketEntry extends PlanAfterPoolingRounds {
  /** The units that enter the bracket phase: what every later check on the field's size reads. */
  bracketEntryCount: number;
}

export interface PlanAfterScoring extends PlanAfterBracketEntry {
  positionalPointsTable: number[] | undefined;
  matchResults: { points: MatchResultPoints; tieMargin: number } | undefined;
}

export interface PlanAfterSizeOverrides extends PlanAfterScoring {
  /** The typed Semis size, or null for the default. */
  semisOverride: number | null;
  finalOverride: number | null;
  semisDefault: number;
}

export interface PlanAfterFinalTargets extends PlanAfterSizeOverrides {
  grandFinalWbTarget: number;
  grandFinalLbTarget: number;
  /** The Final size the shared Final's two kinds of qualifiers add up to. */
  prospectiveFinalSize: number;
  /** Shared-Final double elimination only, as `winnersQualifiers` is. */
  lbQualifiers: number | undefined;
  winnersQualifiers: number | undefined;
}

export interface PlanAfterEliminationOverrides extends PlanAfterFinalTargets {
  explicitTargets: number[] | undefined;
  /** One reseed mode per target, undefined where that round's reseed stays automatic. */
  explicitSeedingOverrides: Array<'diversity' | 'balance' | 'random' | undefined> | undefined;
}

export interface PlanAfterStoredSettings extends PlanAfterEliminationOverrides {
  gamemodeConfig: MaterializedGamemodeConfig;
}

/**
 * The numbers of a tournament, worked out from the Setup form and the loaded roster before any round is built: no
 * names. Each step of `planTournament` reads the plan so far and returns it with its own fields added.
 */
export type TournamentPlan = PlanAfterStoredSettings;
