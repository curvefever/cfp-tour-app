import { getGameFormat } from '../../../domain/tournament/formats';
import type { MatchSettings, RoundStage } from '../../../domain/tournament/round-match-formats';
import type { PersistedSetup, TournamentSettings } from '../../../domain/tournament/types';
import { matchFormatToken, parseMatchFormatToken } from '../../../domain/tournament/waterfall-bracket';

/** A setting of the Setup form; `lbQualifiers` lives outside `PersistedSetup` but is one as well. */
export type FormatField = keyof TournamentSettings;

/** What decides which settings apply: the format, the schedule logic, the pooling phase and the scoring system. */
export type FormatChoices = Pick<PersistedSetup, 'gameFormat' | 'scheduleLogic' | 'poolingPhase' | 'scoring'>;

/** How Setup and the Admin recap word the choices of the draw publication and the round-robin settings. */
export const DRAW_PUBLICATION_LABELS = {
  adaptive: 'Adaptive — reseeded live from real results each round',
  fixed: 'Fixed — full schedule published upfront, no live reseeding',
} as const;

export const ROUND_ROBIN_LABELS = {
  single: 'Single — every pair meets once',
  double: 'Double — every pair meets twice',
} as const;

/** "Single game" or "3 games (sum)": how a Semis or Finals game count is worded. */
export function gamesLabel(games: number): string {
  return games === 1 ? 'Single game' : `${games} games (sum)`;
}

/** What the first stage of the bracket is called by the schedule, in a Setup select and in the recap. */
export function bracketStageLabel(scheduleLogic: PersistedSetup['scheduleLogic']): string {
  switch (scheduleLogic) {
    case 'single-elimination':
      return 'Elimination rounds';
    case 'kings-valley':
      return 'Ladder rounds';
    default:
      return 'Winners rounds';
  }
}

/** The format the setup gives a stage, worded as the stage's select words it. */
export function stageFormatLabel(stage: RoundStage, setup: MatchSettings): string {
  const [games, bestOf] = {
    pooling: [setup.poolingGames, setup.poolingBestOf],
    bracket: [setup.bracketGames, setup.bracketBestOf],
    losers: [setup.losersGames, setup.losersBestOf],
    semis: [setup.semisGames, setup.semisBestOf],
    finals: [setup.finalsGames, setup.finalsBestOf],
  }[stage];
  return matchLabelOf(Number.parseInt(games, 10) || 1, Number.parseInt(bestOf, 10) || undefined);
}

/** The select value an override token stands for ("BO3" is "bo3", "GAMES 2" is "2"), '' for none. */
export function overrideSelectValue(token: string): string {
  const match = parseMatchFormatToken(token);
  if (!match) return '';
  return match.bestOf === undefined ? String(match.games) : `bo${match.bestOf}`;
}

/** The override token a select value stands for, '' for the stage's own format. */
export function overrideTokenOf(value: string): string {
  if (!value) return '';
  return value.startsWith('bo')
    ? matchFormatToken({ games: 1, bestOf: Number(value.slice(2)) })
    : matchFormatToken({ games: Number(value) });
}

/** The Best of N the Semis and Finals format selects offer. */
export const SETUP_BEST_OF = [3, 5, 7];

/** "Single game", "3 games (sum)" or "Best of 3": how the Semis or Finals format is worded. */
export function matchLabelOf(games: number, bestOf: number | undefined): string {
  return bestOf === undefined ? gamesLabel(games) : `Best of ${bestOf}`;
}

/** The value of a Semis or Finals format select: the number of summed games, or "bo3" for a Best of 3. */
export function matchSelectValue(games: string, bestOf: string): string {
  return bestOf.trim() ? `bo${bestOf.trim()}` : games;
}

/** What a select value sets: summed games clear the Best of N, a Best of N leaves the games as they were. */
export function matchFromSelectValue(value: string): { games?: string; bestOf: string } {
  return value.startsWith('bo') ? { bestOf: value.slice(2) } : { games: value, bestOf: '' };
}

/**
 * The settings of the Setup form that apply to these choices: the ones the Format panel shows (and the
 * waterfall panel, for the graph). The Setup form and the running Admin's recap both read this list, so
 * a setting is shown, or hidden, in both at once.
 */
export function visibleFormatFields(choices: FormatChoices): ReadonlySet<FormatField> {
  const { poolingPhase } = choices;
  const format = getGameFormat(choices.gameFormat);
  const isRace = choices.scheduleLogic === 'double-elimination';
  const isSingle = choices.scheduleLogic === 'single-elimination';
  const isShared = choices.scheduleLogic === 'double-elimination-shared-final';
  const isDouble = isRace || isShared;
  const isKings = choices.scheduleLogic === 'kings-valley';
  const fields = new Set<FormatField>([
    'gameFormat',
    'scheduleLogic',
    'poolingPhase',
    'scoring',
    'poolingGames',
    'poolingBestOf',
    'matchOverrides',
  ]);
  const add = (condition: boolean, ...added: FormatField[]) => {
    if (condition) added.forEach((field) => fields.add(field));
  };
  add(Boolean(format?.teamSize), 'teamScoringRule');
  add(poolingPhase === 'qual-table' || poolingPhase === 'swiss', 'drawPublication');
  add(poolingPhase === 'group-stage', 'groupSize', 'roundRobinMode', 'qualifiersPerGroup');
  add(poolingPhase === 'qual-table' || poolingPhase === 'swiss', 'qualAdv', 'nonCountingRounds');
  add((format?.supportedOddCountStrategies?.length ?? 0) > 1, 'oddCountStrategy');
  add(poolingPhase !== 'none' && choices.scoring === 'positional-points', 'positionalPointsTable');
  add(isRace, 'grandFinalWbTarget', 'grandFinalLbTarget');
  add(!isRace, 'finalsGames', 'finalsBestOf');
  add(isSingle || isDouble || isKings, 'bracketGames', 'bracketBestOf');
  add(isDouble, 'losersGames', 'losersBestOf');
  add(isSingle, 'semisOverride', 'semisGames', 'semisBestOf');
  add(isShared, 'lbQualifiers');
  add(isSingle || isShared, 'finalOverride', 'eliminationRoundTargets', 'eliminationSeedingOverrides');
  add(poolingPhase === 'qual-table', 'qualRoundsOverride');
  add(poolingPhase === 'swiss', 'swissRoundsOverride');
  add(choices.scheduleLogic === 'waterfall-bracket', 'waterfallGraph');
  return fields;
}
