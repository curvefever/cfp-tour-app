/**
 * Live change of the Semis format and the Finals format (single elimination, Kings Valley, shared-Final double
 * elimination): a game count to sum, or a Best of N, until the round is finished. The round goes through
 * `changeRoundMatchFormat` (score keys moved, the "fewer games than typed" refusal, absence answers, tie
 * re-check); the settings and `gamemodeConfig` follow, so "Copy settings" copies what was played and the
 * Kings Valley Final re-fit keeps the new value. The Custom bracket changes a round's format through Edit graph.
 */
import { changeRoundMatchFormat, sameMatchFormat } from './match-format-change';
import { semisBestOfProblem, stageMatchFields } from './match-format';
import type { TournamentRound, TournamentState } from './types';

export type MatchStage = 'semis' | 'finals';

/** A stage's format: `games` summed, or a Best of N when `bestOf` is set (`games` is then only remembered). */
export interface StageMatch {
  games: number;
  bestOf?: number;
}

export interface StageMatchEntry extends StageMatch {
  stage: MatchStage;
  label: string;
  index: number;
  /** The round is finished: its format can't change any more. */
  locked: boolean;
  /** Whether a Best of N may be chosen (a Semis only head to head, with a winner for every Final seat). */
  bestOfOffered: boolean;
}

export type StageMatchScope =
  { kind: 'stages'; stages: StageMatchEntry[] } | { kind: 'none'; reason: string };

export type StageMatchEditResult = { ok: true; state: TournamentState } | { ok: false; error: string };

const LABELS: Record<MatchStage, string> = { semis: 'Semis', finals: 'Final' };

function stageRound(state: TournamentState, stage: MatchStage): number {
  return state.rounds.findIndex((round) => (stage === 'semis' ? round.isSemis : round.isFinal));
}

function gamesOf(state: TournamentState, stage: MatchStage, round: TournamentRound): number {
  const kept = stage === 'semis' ? state.gamemodeConfig.semisGames : state.gamemodeConfig.finalsGames;
  return round.bestOf === undefined ? (round.numGames ?? 1) : (kept ?? 1);
}

function stagesOf(state: TournamentState): MatchStage[] | null {
  switch (state.scheduleLogic) {
    case 'single-elimination':
      return ['semis', 'finals'];
    case 'kings-valley':
    case 'double-elimination-shared-final':
      return ['finals'];
    default:
      return null;
  }
}

/** Which stages can have their format changed now, read from the rounds themselves. */
export function stageMatchScope(state: TournamentState): StageMatchScope {
  const stages = stagesOf(state);
  if (!stages) {
    return { kind: 'none', reason: "This schedule logic sets a round's format another way." };
  }
  const entries = stages.flatMap((stage): StageMatchEntry[] => {
    const index = stageRound(state, stage);
    if (index === -1) return [];
    const round = state.rounds[index];
    return [
      {
        stage,
        label: LABELS[stage],
        index,
        games: gamesOf(state, stage, round),
        ...(round.bestOf === undefined ? {} : { bestOf: round.bestOf }),
        locked: index < state.curRound,
        bestOfOffered: stage === 'finals' || semisBestOfProblem([round]) === null,
      },
    ];
  });
  return entries.length > 0
    ? { kind: 'stages', stages: entries }
    : { kind: 'none', reason: 'There is no Semis or Final.' };
}

function fieldsOf(round: TournamentRound, match: StageMatch) {
  return stageMatchFields(match.games, match.bestOf, Math.max(...round.rooms));
}

/** Why the stage can't take the format, or null. */
function refusal(stage: StageMatchEntry, round: TournamentRound, match: StageMatch): string | null {
  const fields = fieldsOf(round, match);
  if (sameMatchFormat(round, fields)) return null;
  if (stage.locked) return `Can't save: "${stage.label}" is finished, so its match format can't change.`;
  if (match.bestOf === undefined) return null;
  if (stage.stage === 'semis') return semisBestOfProblem([round]);
  if (round.anonymousGames?.length) {
    return `Can't save: "${stage.label}" has anonymous games, which a Best of ${match.bestOf} can't have.`;
  }
  return null;
}

/** The settings and `gamemodeConfig` of the stage, set to the new format (no Best of N key when the games are summed). */
function syncConfig(state: TournamentState, stage: MatchStage, match: StageMatch): TournamentState {
  const config = { ...state.gamemodeConfig };
  const settings = state.settings && { ...state.settings };
  const bestOf = match.bestOf;
  if (stage === 'semis') {
    config.semisGames = match.games;
    if (bestOf === undefined) delete config.semisBestOf;
    else config.semisBestOf = bestOf;
    if (settings)
      Object.assign(settings, { semisGames: String(match.games), semisBestOf: String(bestOf ?? '') });
  } else {
    config.finalsGames = match.games;
    if (bestOf === undefined) delete config.finalsBestOf;
    else config.finalsBestOf = bestOf;
    if (settings)
      Object.assign(settings, { finalsGames: String(match.games), finalsBestOf: String(bestOf ?? '') });
  }
  return { ...state, gamemodeConfig: config, settings };
}

/**
 * The state with the Semis and/or the Final played in the given formats. Nothing is changed when any stage is
 * refused: a finished round, a Best of N the Semis can't have, a Final with anonymous games, or fewer games
 * than a score already typed.
 */
export function applyStageMatchEdit(
  state: TournamentState,
  input: Partial<Record<MatchStage, StageMatch>>,
): StageMatchEditResult {
  const scope = stageMatchScope(state);
  if (scope.kind === 'none') return { ok: false, error: scope.reason };
  const wanted = scope.stages.flatMap((entry) => {
    const match = input[entry.stage];
    return match ? [{ entry, match }] : [];
  });
  if (wanted.length === 0) return { ok: false, error: 'There is no Semis or Final format to change here.' };
  let working = state;
  for (const { entry, match } of wanted) {
    const round = working.rounds[entry.index];
    const problem = refusal(entry, round, match);
    if (problem) return { ok: false, error: problem };
    if (entry.locked) continue;
    const changed = changeRoundMatchFormat(working, entry.index, fieldsOf(round, match));
    if ('error' in changed) return { ok: false, error: changed.error };
    working = syncConfig(changed.state, entry.stage, match);
  }
  return { ok: true, state: working };
}
