/**
 * The match format of every round: the one place that decides a round's `bestOf` / `numGames` from its stage, the
 * round overrides and the config. Every builder of rounds (generation, a rebuilt future, the Kings Valley tail)
 * runs its rounds through `applyMatchFormats`, so no builder knows its own stage's format.
 *
 * A round's format = its override (stored by `roundNoteNames`, written as a ROUNDS-line token: "BO3", "GAMES 2"),
 * else its stage's format, else one game. A graph round of a Custom bracket and the race Grand Final have no stage.
 */
import { BEST_OF_VALUES, stageMatchFields } from './match-format';
import { isPoolingRound } from './pooling';
import { roundNoteNames, roundNoteRows } from './round-notes';
import type {
  MaterializedGamemodeConfig,
  PersistedSetup,
  ScheduleLogicKey,
  TournamentRound,
  TournamentState,
} from './types';
import { matchFormatFields, parseMatchFormatToken } from './waterfall-bracket';

type GamemodeConfig = TournamentState['gamemodeConfig'];

export type RoundStage = 'pooling' | 'bracket' | 'losers' | 'semis' | 'finals';

/** The stage formats and round overrides of a config, each absent for its default. */
export type MatchFormatConfig = Partial<
  Pick<
    MaterializedGamemodeConfig,
    | 'poolingGames'
    | 'poolingBestOf'
    | 'bracketGames'
    | 'bracketBestOf'
    | 'losersGames'
    | 'losersBestOf'
    | 'semisGames'
    | 'semisBestOf'
    | 'finalsGames'
    | 'finalsBestOf'
    | 'matchOverrides'
  >
>;

/**
 * The overrides a Setup text holds, one "Round 2: BO3" line each: the round name, a colon, a ROUNDS-line token. A
 * line that spells no match format is left out, and a name written twice takes its last line.
 */
export function parseMatchOverrides(text: string): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.lastIndexOf(':');
    const name = line.slice(0, colon).trim();
    const token = line.slice(colon + 1).trim();
    if (colon > 0 && name && parseMatchFormatToken(token)) overrides[name] = token;
  }
  return overrides;
}

/** The Setup text of some overrides, in the order given. */
export function matchOverridesText(overrides: Record<string, string>): string {
  return Object.entries(overrides)
    .map(([name, token]) => `${name}: ${token}`)
    .join('\n');
}

/** The Setup fields that set a match format: the stages' games and Best of N, and the round overrides. */
export type MatchSettings = Pick<
  PersistedSetup,
  | 'poolingGames'
  | 'poolingBestOf'
  | 'bracketGames'
  | 'bracketBestOf'
  | 'losersGames'
  | 'losersBestOf'
  | 'semisGames'
  | 'semisBestOf'
  | 'finalsGames'
  | 'finalsBestOf'
  | 'matchOverrides'
>;

const MATCH_SETTING_KEYS = [
  'poolingGames',
  'poolingBestOf',
  'bracketGames',
  'bracketBestOf',
  'losersGames',
  'losersBestOf',
  'semisGames',
  'semisBestOf',
  'finalsGames',
  'finalsBestOf',
  'matchOverrides',
] as const satisfies readonly (keyof MatchSettings)[];

function wholeNumber(text: string | undefined, fallback: number): number {
  return Number.parseInt(text ?? '', 10) || fallback;
}

/** The N of a Best of N setting, or undefined for summed games (and for a setting whose select is hidden). */
function bestOfSetting(text: string, visible: boolean): number | undefined {
  const bestOf = wholeNumber(text, 0);
  return visible && BEST_OF_VALUES.includes(bestOf) ? bestOf : undefined;
}

/** A stage's games and Best of N for the gamemode config: each only when it is not the default, and nothing for a stage whose select is hidden. */
function otherStageConfig(
  stage: 'pooling' | 'bracket' | 'losers',
  form: MatchSettings,
  visible: boolean,
): MatchFormatConfig {
  const games = wholeNumber(form[`${stage}Games`], 1);
  const bestOf = bestOfSetting(form[`${stage}BestOf`], visible);
  return {
    ...(visible && games !== 1 ? { [`${stage}Games`]: games } : {}),
    ...(bestOf !== undefined ? { [`${stage}BestOf`]: bestOf } : {}),
  };
}

/**
 * The match format part of the gamemode config, from the Setup form: the Semis and Finals games always, every other
 * stage's games and every Best of N only when set and when the schedule has that select, and the overrides that
 * spell a format. A setting whose select is hidden is ignored (the form keeps its value for when it comes back).
 */
export function matchFormatConfig(
  form: MatchSettings,
  schedule: ScheduleLogicKey,
): MatchFormatConfig & { finalsGames: number; semisGames: number } {
  const isDouble = schedule === 'double-elimination' || schedule === 'double-elimination-shared-final';
  const finalsBestOf = bestOfSetting(form.finalsBestOf, schedule !== 'double-elimination');
  const semisBestOf = bestOfSetting(form.semisBestOf, schedule === 'single-elimination');
  const overrides = parseMatchOverrides(form.matchOverrides);
  return {
    finalsGames: wholeNumber(form.finalsGames, 3),
    semisGames: wholeNumber(form.semisGames, 1),
    ...(finalsBestOf !== undefined ? { finalsBestOf } : {}),
    ...(semisBestOf !== undefined ? { semisBestOf } : {}),
    ...otherStageConfig('pooling', form, true),
    ...otherStageConfig('bracket', form, schedule !== 'waterfall-bracket'),
    ...otherStageConfig('losers', form, isDouble),
    ...(Object.keys(overrides).length > 0 ? { matchOverrides: overrides } : {}),
  };
}

/**
 * A schedule drawn but not started, played in the match formats of the Setup form now: the config and the settings
 * snapshot take the form's, and the rounds are formatted again (a pre-start round has nothing played).
 */
export function withFormMatchFormats(state: TournamentState, form: MatchSettings): TournamentState {
  if (!state.rounds.length || state.started) return state;
  const kept = Object.fromEntries(
    Object.entries(state.gamemodeConfig).filter(
      ([key]) => !(MATCH_SETTING_KEYS as readonly string[]).includes(key),
    ),
  ) as typeof state.gamemodeConfig;
  const gamemodeConfig = { ...kept, ...matchFormatConfig(form, state.scheduleLogic) };
  const formatted = applyMatchFormats(state.rounds, gamemodeConfig);
  const snapshot = Object.fromEntries(MATCH_SETTING_KEYS.map((key) => [key, form[key]]));
  return {
    ...state,
    gamemodeConfig,
    settings: state.settings && { ...state.settings, ...snapshot },
    rounds: formatted.map((round) => withGraphFormat(round, gamemodeConfig)),
  };
}

/**
 * A graph round of a Custom bracket has no stage: it plays the format of its own ROUNDS line, and the Final with none
 * of its own the Finals format. A drawn graph keeps the round's line in the config, so a Finals format change before
 * the start reaches that Final as generation would have given it.
 */
function withGraphFormat(round: TournamentRound, config: GamemodeConfig): TournamentRound {
  const spec = round.isWaterfall
    ? config.graph?.rounds.find((entry) => entry.label === round.customLabel)
    : null;
  if (!spec) return round;
  const { bestOf: _bestOf, numGames: _numGames, ...unformatted } = round;
  return {
    ...unformatted,
    ...matchFormatFields({ ...spec, roomSizes: round.rooms }, config.finalsGames ?? 3, config.finalsBestOf),
  };
}

/** One round of the drawn schedule in the override list, or an override that no round has now. */
export interface MatchOverrideRow {
  name: string;
  /** The stage whose format the round plays unless it has an override; absent for an orphan. */
  stage?: RoundStage;
  /** The name the Bracket shows, when it differs from the stored one. */
  shown?: string;
  /** The override's token ("BO3", "GAMES 2"), '' for none (the round plays its stage's format). */
  token: string;
  /** A stored name that no round of the schedule has now: it does nothing. */
  orphan?: true;
}

/** One row per round that has a stage, in schedule order, then one per override whose name no round has. */
export function matchOverrideRows(state: TournamentState, overridesText: string): MatchOverrideRow[] {
  const overrides = parseMatchOverrides(overridesText);
  const named = roundNoteRows(state, undefined);
  const rows = state.rounds.flatMap((round, index): MatchOverrideRow[] => {
    const stage = matchStage(round);
    if (stage === null) return [];
    const { name, shown } = named[index];
    return [{ name, stage, ...(shown !== undefined && { shown }), token: overrides[name] ?? '' }];
  });
  const known = new Set(named.map((row) => row.name));
  for (const [name, token] of Object.entries(overrides)) {
    if (!known.has(name)) rows.push({ name, token, orphan: true });
  }
  return rows;
}

/** The overrides text with one round's line set to `token`, or removed for ''. */
export function withMatchOverride(overridesText: string, name: string, token: string): string {
  const { [name]: _removed, ...rest } = parseMatchOverrides(overridesText);
  return matchOverridesText(token ? { ...rest, [name]: token } : rest);
}

/** The stage a round belongs to; null for a graph round of a Custom bracket and for the race Grand Final, which keep their own format. */
export function matchStage(round: TournamentRound): RoundStage | null {
  if (round.isWaterfall || round.bracket === 'grand-final') return null;
  if (round.isFinal) return 'finals';
  if (round.isSemis) return 'semis';
  if (isPoolingRound(round)) return 'pooling';
  return round.bracket === 'losers' ? 'losers' : 'bracket';
}

/** What the first stage of the bracket is called by the schedule, in a Setup select, the recap and the Admin. */
export function bracketStageLabel(scheduleLogic: ScheduleLogicKey): string {
  switch (scheduleLogic) {
    case 'single-elimination':
      return 'Elimination rounds';
    case 'kings-valley':
      return 'Ladder rounds';
    default:
      return 'Winners rounds';
  }
}

/** A stage's format: summed `games`, or a Best of N when `bestOf` is set. */
export function stageFormat(
  stage: RoundStage,
  config: MatchFormatConfig,
): { games: number; bestOf?: number } {
  switch (stage) {
    case 'pooling':
      return { games: config.poolingGames ?? 1, bestOf: config.poolingBestOf };
    case 'bracket':
      return { games: config.bracketGames ?? 1, bestOf: config.bracketBestOf };
    case 'losers':
      return { games: config.losersGames ?? 1, bestOf: config.losersBestOf };
    case 'semis':
      return { games: config.semisGames ?? 1, bestOf: config.semisBestOf };
    case 'finals':
      return { games: config.finalsGames ?? 3, bestOf: config.finalsBestOf };
  }
}

/** The format of one round, or null when it has no stage. */
function roundFormat(
  round: TournamentRound,
  name: string,
  config: MatchFormatConfig,
): { games: number; bestOf?: number } | null {
  const stage = matchStage(round);
  if (!stage) return null;
  const override = config.matchOverrides?.[name];
  return (override === undefined ? null : parseMatchFormatToken(override)) ?? stageFormat(stage, config);
}

/**
 * The rounds with their match format set, from `from` on (the rounds before it are returned as they are). The Semis
 * and the Final always carry theirs; any other round carries one only when it is not the default single game, so a
 * freshly built round with nothing to say stays as the builder made it.
 */
export function applyMatchFormats(
  rounds: TournamentRound[],
  config: MatchFormatConfig,
  from = 0,
): TournamentRound[] {
  const names = roundNoteNames({ rounds });
  return rounds.map((round, index) => {
    if (index < from) return round;
    const format = roundFormat(round, names[index], config);
    if (!format) return round;
    const { bestOf, games } = format;
    const stage = matchStage(round);
    const { bestOf: _bestOf, numGames: _numGames, ...unformatted } = round;
    if (bestOf === undefined && games === 1 && stage !== 'semis' && stage !== 'finals') return unformatted;
    return { ...unformatted, ...stageMatchFields(games, bestOf, Math.max(1, ...round.rooms)) };
  });
}
