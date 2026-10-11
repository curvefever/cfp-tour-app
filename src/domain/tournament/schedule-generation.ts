import { buildFixedRoomSchedule, buildFixedSwissSchedule } from './fixed-draws';
import {
  groupStagePoolingPhase,
  noEliminationWarmupPoolingPhase,
  qualificationTablePoolingPhase,
  swissPoolingPhase,
  type PoolingConfig,
  type PoolingFormatConfig,
  type PoolingPhaseResult,
} from './pooling';
import {
  raceDoubleEliminationBracketPhase,
  sharedFinalDoubleEliminationBracketPhase,
  type RaceDoubleEliminationConfig,
  type SharedFinalDoubleEliminationConfig,
} from './double-elimination';
import { kingsValleyBracketPhase, type KingsValleyConfig } from './kings-valley';
import { singleEliminationBracketPhase, type SingleEliminationConfig } from './single-elimination';
import {
  waterfallBracketPhase,
  waterfallStandingsRoutes,
  type WaterfallBracketConfig,
} from './waterfall-bracket';
import type { PoolingPhaseKey, RoomSize, ScheduleLogicKey, TournamentGroup, TournamentRound } from './types';

interface TournamentProgression {
  rounds: TournamentRound[];
  groups: TournamentGroup[];
}

interface CommonGenerationInput {
  poolingPhase: PoolingPhaseKey;
  config: PoolingConfig;
  roster: string[];
}

export type TournamentProgressionInput =
  | (CommonGenerationInput & {
      bracketPhase: 'single-elimination';
      format: PoolingFormatConfig & SingleEliminationConfig;
    })
  | (CommonGenerationInput & {
      bracketPhase: 'double-elimination';
      format: PoolingFormatConfig & RaceDoubleEliminationConfig;
    })
  | (CommonGenerationInput & {
      bracketPhase: 'double-elimination-shared-final';
      format: PoolingFormatConfig & SharedFinalDoubleEliminationConfig;
    })
  | (CommonGenerationInput & {
      bracketPhase: 'kings-valley';
      format: PoolingFormatConfig & KingsValleyConfig;
    })
  | (CommonGenerationInput & {
      bracketPhase: 'waterfall-bracket';
      format: PoolingFormatConfig & WaterfallBracketConfig;
    });

export function getMinimumBracketUnits(bracketPhase: ScheduleLogicKey, roomSize: RoomSize): number {
  // Waterfall's real floor is enforced precisely against the organiser's own
  // graph (validateAndOrderWaterfallGraph's rule 9, checked in generation.ts)
  // -- this early, generic gate only needs to let any positive count through
  // so that later, more specific error reaches the organiser instead.
  if (bracketPhase === 'waterfall-bracket') return 1;
  return bracketPhase === 'double-elimination' ? 4 : 2 * roomSize.ideal;
}

function buildPoolingPhase(
  input: CommonGenerationInput & { format: PoolingFormatConfig },
): PoolingPhaseResult {
  switch (input.poolingPhase) {
    case 'qual-table': {
      const result = qualificationTablePoolingPhase(input.config, input.format);
      if (input.format.drawPublication === 'fixed') {
        const fixed = buildFixedRoomSchedule(input.roster, result.rounds);
        result.rounds = result.rounds.map((round, index) => ({
          ...round,
          fixedRoomAssignments: fixed.rounds[index],
        }));
      }
      return result;
    }
    case 'swiss': {
      const result = swissPoolingPhase(input.config, input.format);
      if (input.format.drawPublication === 'fixed') {
        const fixed = buildFixedSwissSchedule(input.roster, result.rounds.length);
        result.rounds = result.rounds.map((round, index) => ({
          ...round,
          fixedRoomAssignments: fixed[index],
          pairingTBD: false,
        }));
      }
      return result;
    }
    case 'group-stage':
      return groupStagePoolingPhase(input.config, input.roster);
    case 'none':
      return noEliminationWarmupPoolingPhase(input.config, input.format);
  }
}

/** A waterfall graph with a Qual source puts its standings routing on the last qualification round. */
function withStandingsRoutes(
  pooledRounds: TournamentRound[],
  routes: TournamentRound['standingsRoutes'],
): TournamentRound[] {
  if (!routes) return pooledRounds;
  const last = pooledRounds.length - 1;
  return pooledRounds.map((round, index) => (index === last ? { ...round, standingsRoutes: routes } : round));
}

export function buildTournamentProgression(input: TournamentProgressionInput): TournamentProgression {
  const pooled = buildPoolingPhase(input);
  let pooledRounds = pooled.rounds;
  let bracket: TournamentRound[];
  switch (input.bracketPhase) {
    case 'single-elimination':
      bracket = singleEliminationBracketPhase(pooled.seedTotal, pooled.nextRoundNum, input.format);
      break;
    case 'double-elimination':
      bracket = raceDoubleEliminationBracketPhase(pooled.seedTotal, pooled.nextRoundNum, input.format);
      break;
    case 'double-elimination-shared-final':
      bracket = sharedFinalDoubleEliminationBracketPhase(pooled.seedTotal, pooled.nextRoundNum, input.format);
      break;
    case 'kings-valley':
      bracket = kingsValleyBracketPhase(pooled.seedTotal, pooled.nextRoundNum, input.format);
      break;
    case 'waterfall-bracket':
      bracket = waterfallBracketPhase(pooled.seedTotal, pooled.nextRoundNum, input.format);
      pooledRounds = withStandingsRoutes(
        pooledRounds,
        waterfallStandingsRoutes(input.format.graph, pooled.nextRoundNum),
      );
      break;
  }
  return {
    rounds: [...pooledRounds, ...bracket],
    groups: pooled.groups ?? [],
  };
}
