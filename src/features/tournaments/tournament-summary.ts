import type {
  GameFormatKey,
  PersistedSetup,
  PoolingPhaseKey,
  ScheduleLogicKey,
  TournamentState,
  TournamentStatus,
} from '../../domain/tournament/types';

/** What the tournament lists show about one tournament; small enough to be read for all of them at once. */
export interface TournamentSummary {
  id: string;
  title: string;
  status: TournamentStatus;
  started: boolean;
  testRun: boolean;
  /** Epoch milliseconds. */
  scheduledAt: number | null;
  createdAt: number;
  finishedAt: number | null;
  gameFormat: GameFormatKey;
  poolingPhase: PoolingPhaseKey;
  scheduleLogic: ScheduleLogicKey;
  /** Players, or teams in a team format. */
  unitCount: number;
}

/** The summary fields that follow what an admin types; the status fields belong to the lifecycle server functions. */
export type TournamentDescription = Pick<
  TournamentSummary,
  'title' | 'scheduledAt' | 'gameFormat' | 'poolingPhase' | 'scheduleLogic' | 'unitCount'
>;

export const DESCRIPTION_KEYS = [
  'title',
  'scheduledAt',
  'gameFormat',
  'poolingPhase',
  'scheduleLogic',
  'unitCount',
] as const satisfies readonly (keyof TournamentDescription)[];

/** The summary fields that follow the tournament's state: what a state patch can change. */
export function stateDescription(
  state: TournamentState,
): Pick<TournamentDescription, 'title' | 'scheduledAt' | 'unitCount'> {
  return {
    title: state.title,
    scheduledAt: state.info?.scheduledAt ?? null,
    unitCount: state.players.length,
  };
}

/** The summary fields that follow the Setup form: what a setup patch can change. */
export function setupDescription(
  setup: PersistedSetup,
): Pick<TournamentDescription, 'gameFormat' | 'poolingPhase' | 'scheduleLogic'> {
  return {
    gameFormat: setup.gameFormat,
    poolingPhase: setup.poolingPhase,
    scheduleLogic: setup.scheduleLogic,
  };
}

export function buildTournamentSummary(state: TournamentState, setup: PersistedSetup): TournamentDescription {
  return { ...stateDescription(state), ...setupDescription(setup) };
}

/** The fields of `next` whose value differs from `previous`. */
export function changedDescription<T extends Partial<TournamentDescription>>(
  previous: T,
  next: T,
): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (previous[key] !== next[key]) changed[key] = next[key];
  }
  return changed;
}

const MAX_SUMMARY_TEXT_LENGTH = 500;

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SUMMARY_TEXT_LENGTH;
}

const DESCRIPTION_CHECKS: Record<keyof TournamentDescription, (value: unknown) => boolean> = {
  title: isShortString,
  scheduledAt: (value) => value === null || (typeof value === 'number' && Number.isFinite(value)),
  gameFormat: isShortString,
  poolingPhase: isShortString,
  scheduleLogic: isShortString,
  unitCount: (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
};

/** Checks the descriptive summary fields sent with a write, keeping only the known ones. */
export function parseDescriptionFields(value: unknown): Partial<TournamentDescription> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid tournament summary.');
  const record = value as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of DESCRIPTION_KEYS) {
    if (record[key] === undefined) continue;
    if (!DESCRIPTION_CHECKS[key](record[key])) throw new Error(`Invalid tournament summary field: ${key}`);
    fields[key] = record[key];
  }
  return fields;
}
