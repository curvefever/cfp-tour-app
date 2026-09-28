import { createDefaultSetup } from './state-defaults';
import type { PersistedSetup, TournamentSettings } from './types';

/**
 * Every TournamentSettings key except `lbQualifiers`, which lives outside
 * PersistedSetup (see GenerationForm in generation.ts). Written out
 * explicitly -- not spread-and-delete from PersistedSetup -- so the
 * key-partition invariant below (tested) catches a new Setup field that
 * isn't added to either this list or ROSTER_KEYS.
 */
const SETTING_KEYS = [
  'scheduleLogic',
  'gameFormat',
  'scoring',
  'positionalPointsTable',
  'drawPublication',
  'poolingPhase',
  'qualAdv',
  'nonCountingRounds',
  'groupSize',
  'roundRobinMode',
  'qualifiersPerGroup',
  'finalsGames',
  'semisGames',
  'grandFinalWbTarget',
  'grandFinalLbTarget',
  'semisOverride',
  'finalOverride',
  'qualRoundsOverride',
  'swissRoundsOverride',
  'eliminationRoundTargets',
  'eliminationSeedingOverrides',
  'waterfallGraph',
  'oddCountStrategy',
  'teamScoringRule',
] as const satisfies readonly (keyof PersistedSetup)[];

/** The three PersistedSetup fields a settings snapshot never carries. */
export const ROSTER_KEYS = [
  'roster',
  'reserves',
  'reserveIndividuals',
] as const satisfies readonly (keyof PersistedSetup)[];

const DEFAULT_LB_QUALIFIERS = '2';

/** Same key-partition invariant `readTournamentSettings`/`applyTournamentSettings`/`settingsFromForm` all rely on -- exported for the test that checks it against `createDefaultSetup()`. */
export const TOURNAMENT_SETTING_KEYS = SETTING_KEYS;

export function settingsFromForm(form: PersistedSetup & { lbQualifiers?: string }): TournamentSettings {
  const settings: Record<string, string> = { lbQualifiers: form.lbQualifiers ?? DEFAULT_LB_QUALIFIERS };
  for (const key of SETTING_KEYS) {
    settings[key] = form[key];
  }
  return settings as unknown as TournamentSettings;
}

/** `null` unless `raw` is a plain object -- e.g. a tournament generated before `settings` existed, or a non-object value. */
export function readTournamentSettings(raw: unknown): TournamentSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const defaults = createDefaultSetup();
  const settings: Record<string, string> = { lbQualifiers: DEFAULT_LB_QUALIFIERS };
  for (const key of SETTING_KEYS) {
    settings[key] = defaults[key];
  }
  for (const key of [...SETTING_KEYS, 'lbQualifiers'] as const) {
    const value = record[key];
    if (typeof value === 'string') settings[key] = value;
  }
  return settings as unknown as TournamentSettings;
}

/** Every setting key from `settings`, the roster fields from `setup`, and no `qual` (legacy key -- poolingPhase decides now). */
export function applyTournamentSettings(setup: PersistedSetup, settings: TournamentSettings): PersistedSetup {
  const next: PersistedSetup = { ...setup };
  for (const key of SETTING_KEYS) {
    (next as unknown as Record<string, string>)[key] = settings[key];
  }
  delete next.qual;
  return next;
}
