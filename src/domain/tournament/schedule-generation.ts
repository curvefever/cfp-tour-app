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
    });

export function getMinimumBracketUnits(bracketPhase: ScheduleLogicKey, roomSize: RoomSize): number {
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

export function buildTournamentProgression(input: TournamentProgressionInput): TournamentProgression {
  const pooled = buildPoolingPhase(input);
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
  }
  return {
    rounds: [...pooled.rounds, ...bracket],
    groups: pooled.groups ?? [],
  };
}
