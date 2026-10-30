/**
 * Live change of the match format of the rounds not finished yet, the round in play included: a stage's format (the
 * default of its rounds that have no override) and a round's own format (its override), each a game count to sum or
 * a Best of N. Every round that plays another format goes through `changeRoundMatchFormat` (score keys moved, the
 * "fewer games than typed" refusal, absence answers, tie re-check); the stage formats and the overrides are written to
 * `gamemodeConfig` and the settings snapshot too, so "Copy settings" copies what was played and every rebuilt round
 * (a re-fitted Kings Valley tail, a live advancement edit) keeps them. A round already finished never changes, and a
 * graph round of a Custom bracket changes through Edit graph.
 */
import { changeRoundMatchFormat, sameMatchFormat } from './match-format-change';
import { isRoundDone } from './round-columns';
import {
  applyMatchFormats,
  bracketStageLabel,
  matchOverridesText,
  matchStage,
  parseMatchOverrides,
  stageFormat,
  type RoundStage,
} from './round-match-formats';
import { roundNoteRows } from './round-notes';
import type { TournamentState } from './types';

type GamemodeConfig = TournamentState['gamemodeConfig'];
import { matchFormatToken, parseMatchFormatToken } from './waterfall-bracket';

export type MatchStage = RoundStage;

/** A format: `games` summed, or a Best of N when `bestOf` is set (`games` is then only remembered). */
export interface StageMatch {
  games: number;
  bestOf?: number;
}

export interface StageMatchEntry extends StageMatch {
  stage: MatchStage;
  label: string;
  /** Every round of the stage is finished: its format can't change any more. */
  locked: boolean;
}

/** A round not finished yet, with the override it has. */
export interface RoundMatchEntry {
  /** The round's name, `roundNoteNames`: what its override is stored under. */
  name: string;
  /** The name the Bracket shows, when it differs. */
  shown?: string;
  stage: MatchStage;
  index: number;
  /** The override's format; absent when the round plays its stage's. */
  override?: StageMatch;
}

export type StageMatchScope =
  { kind: 'stages'; stages: StageMatchEntry[]; rounds: RoundMatchEntry[] } | { kind: 'none'; reason: string };

export type StageMatchEditResult = { ok: true; state: TournamentState } | { ok: false; error: string };

/** What to change: the formats of some stages, and the overrides of some rounds by name (null clears one). */
export interface MatchEditInput {
  stages?: Partial<Record<MatchStage, StageMatch>>;
  rounds?: Record<string, StageMatch | null>;
}

const STAGES: MatchStage[] = ['pooling', 'bracket', 'losers', 'semis', 'finals'];

function stageLabel(stage: MatchStage, state: TournamentState): string {
  switch (stage) {
    case 'pooling':
      return 'Pooling rounds';
    case 'bracket':
      return bracketStageLabel(state.scheduleLogic);
    case 'losers':
      return 'Losers rounds';
    case 'semis':
      return 'Semis';
    case 'finals':
      return 'Final';
  }
}

function sameStageMatch(first: StageMatch, second: StageMatch): boolean {
  return first.bestOf === second.bestOf && (first.bestOf !== undefined || first.games === second.games);
}

function openIndexes(state: TournamentState): number[] {
  return state.rounds.flatMap((round, index) =>
    matchStage(round) !== null && !isRoundDone(state, index) ? [index] : [],
  );
}

/** What can be changed now: the stages the schedule has and the rounds not finished yet. */
export function stageMatchScope(state: TournamentState): StageMatchScope {
  const present = new Set(state.rounds.map(matchStage));
  const open = openIndexes(state);
  const stages = STAGES.filter((stage) => present.has(stage)).map((stage): StageMatchEntry => {
    const { games, bestOf } = stageFormat(stage, state.gamemodeConfig);
    return {
      stage,
      label: stageLabel(stage, state),
      games,
      ...(bestOf === undefined ? {} : { bestOf }),
      locked: !open.some((index) => matchStage(state.rounds[index]) === stage),
    };
  });
  if (stages.length === 0)
    return { kind: 'none', reason: 'A Custom bracket sets its round formats in Edit graph.' };
  const named = roundNoteRows(state, undefined);
  const overrides = parseMatchOverrides(matchOverridesText(state.gamemodeConfig.matchOverrides ?? {}));
  const rounds = open.map((index): RoundMatchEntry => {
    const { name, shown } = named[index];
    const override = parseMatchFormatToken(overrides[name] ?? '');
    return {
      name,
      stage: matchStage(state.rounds[index]) as MatchStage,
      index,
      ...(shown === undefined ? {} : { shown }),
      ...(override ? { override } : {}),
    };
  });
  return { kind: 'stages', stages, rounds };
}

type StageKeys = 'Games' | 'BestOf';
type StageConfigKey = `${MatchStage}${StageKeys}`;

/** The gamemode config with the stage's format written: the games always for the Semis and the Final, otherwise only when not the default one game; no Best of N key when the games are summed. */
function withStageConfig(config: GamemodeConfig, stage: MatchStage, match: StageMatch): GamemodeConfig {
  const next: Record<string, unknown> = { ...config };
  const gamesKey: StageConfigKey = `${stage}Games`;
  const bestOfKey: StageConfigKey = `${stage}BestOf`;
  const alwaysGames = stage === 'semis' || stage === 'finals';
  if (alwaysGames || match.games !== 1) next[gamesKey] = match.games;
  else delete next[gamesKey];
  if (match.bestOf === undefined) delete next[bestOfKey];
  else next[bestOfKey] = match.bestOf;
  return next;
}

/** The new config and settings snapshot: the stage formats and the overrides asked for. */
function withMatchSettings(state: TournamentState, input: MatchEditInput): TournamentState {
  let config = state.gamemodeConfig;
  const settings: Record<string, string> = {};
  for (const [stage, match] of Object.entries(input.stages ?? {}) as Array<[MatchStage, StageMatch]>) {
    config = withStageConfig(config, stage, match);
    settings[`${stage}Games`] = String(match.games);
    settings[`${stage}BestOf`] = String(match.bestOf ?? '');
  }
  if (input.rounds) {
    const overrides = { ...config.matchOverrides };
    for (const [name, match] of Object.entries(input.rounds)) {
      if (match === null) delete overrides[name];
      else overrides[name] = matchFormatToken(match);
    }
    const { matchOverrides: _old, ...rest } = config;
    config = Object.keys(overrides).length > 0 ? { ...rest, matchOverrides: overrides } : rest;
    settings.matchOverrides = matchOverridesText(overrides);
  }
  return {
    ...state,
    gamemodeConfig: config,
    settings: state.settings && { ...state.settings, ...settings },
  };
}

/** Why the input can't be taken, or null: a finished round or stage whose format would change, or a round the schedule does not have. */
function inputRefusal(
  state: TournamentState,
  scope: StageMatchScope & { kind: 'stages' },
  input: MatchEditInput,
): string | null {
  for (const [stage, match] of Object.entries(input.stages ?? {}) as Array<[MatchStage, StageMatch]>) {
    const entry = scope.stages.find((candidate) => candidate.stage === stage);
    if (!entry) return `There is no ${stage} stage to change here.`;
    if (entry.locked && !sameStageMatch(entry, match)) {
      return `Can't save: "${entry.label}" is finished, so its match format can't change.`;
    }
  }
  const names = new Set(roundNoteRows(state, undefined).map((row) => row.name));
  for (const [name, match] of Object.entries(input.rounds ?? {})) {
    if (!names.has(name)) return `Can't save: the schedule has no round "${name}".`;
    const entry = scope.rounds.find((candidate) => candidate.name === name);
    const current = entry?.override ?? null;
    const unchanged = match === null ? current === null : current !== null && sameStageMatch(current, match);
    if (!entry && !unchanged) return `Can't save: "${name}" is finished, so its match format can't change.`;
  }
  return null;
}

/**
 * The state with the stages and rounds played in the given formats. Nothing is changed when any round is refused: a
 * finished round or stage, a Best of N for a Final with anonymous games, or fewer games than a score already typed.
 */
export function applyStageMatchEdit(
  state: TournamentState,
  stages: MatchEditInput['stages'],
  rounds: MatchEditInput['rounds'] = {},
): StageMatchEditResult {
  const input: MatchEditInput = { stages, rounds };
  const scope = stageMatchScope(state);
  if (scope.kind === 'none') return { ok: false, error: scope.reason };
  const refused = inputRefusal(state, scope, input);
  if (refused) return { ok: false, error: refused };

  const edited = withMatchSettings(state, input);
  const formatted = applyMatchFormats(state.rounds, edited.gamemodeConfig);
  let working = edited;
  for (const { index } of scope.rounds) {
    const round = working.rounds[index];
    const wanted = { bestOf: formatted[index].bestOf, numGames: formatted[index].numGames };
    if (sameMatchFormat(round, wanted)) continue;
    if (wanted.bestOf !== undefined && round.anonymousGames?.length) {
      return {
        ok: false,
        error: `Can't save: "Final" has anonymous games, which a Best of ${wanted.bestOf} can't have.`,
      };
    }
    const changed = changeRoundMatchFormat(working, index, wanted);
    if ('error' in changed) return { ok: false, error: changed.error };
    working = changed.state;
  }
  return { ok: true, state: working };
}
