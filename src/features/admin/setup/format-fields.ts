import { getGameFormat } from '../../../domain/tournament/formats';
import type { PersistedSetup, TournamentSettings } from '../../../domain/tournament/types';

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
  const fields = new Set<FormatField>(['gameFormat', 'scheduleLogic', 'poolingPhase', 'scoring']);
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
  add(!isRace, 'finalsGames');
  add(isSingle, 'semisOverride', 'semisGames');
  add(isShared, 'lbQualifiers');
  add(isSingle || isShared, 'finalOverride', 'eliminationRoundTargets', 'eliminationSeedingOverrides');
  add(poolingPhase === 'qual-table', 'qualRoundsOverride');
  add(poolingPhase === 'swiss', 'swissRoundsOverride');
  add(choices.scheduleLogic === 'waterfall-bracket', 'waterfallGraph');
  return fields;
}
