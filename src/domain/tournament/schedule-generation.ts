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
  type SharedFinalDoubleEliminationConfig,
} from './double-elimination';
import { kingsValleyBracketPhase } from './kings-valley';
import { markAppWrittenStages } from './app-written-bracket';
import { singleEliminationBracketPhase, type SingleEliminationConfig } from './single-elimination';
import {
  waterfallBracketPhase,
  waterfallStandingsRoutes,
  type WaterfallBracketConfig,
} from './waterfall-bracket';
import { applyMatchFormats, type MatchFormatConfig } from './round-match-formats';
import { hasAppWrittenMark } from './rule-versions';
import type { PoolingPhaseKey, RoomSize, ScheduleLogicKey, TournamentGroup, TournamentRound } from './types';

interface TournamentProgression {
  rounds: TournamentRound[];
  groups: TournamentGroup[];
}

/**
 * The numbers the builders need, as a tournament's stored settings hold them: every phase's builder reads its own part,
 * and the settings of a bracket phase only exist for that phase (`lbQualifiers` for a shared Final, `graph` for a Custom
 * bracket), so those two are optional here and checked by the builder of the phase.
 */
export type ScheduleFormat = PoolingFormatConfig &
  SingleEliminationConfig &
  MatchFormatConfig &
  Pick<WaterfallBracketConfig, 'finalsGames' | 'finalsBestOf'> &
  Partial<Pick<SharedFinalDoubleEliminationConfig, 'lbQualifiers'>> &
  Partial<Pick<WaterfallBracketConfig, 'graph'>> & { upperLowerVersion?: 1; layeredVersion?: 1 };

/** What `buildScheduleRounds` builds the rounds from: not the Setup form, but the numbers worked out from it. */
export interface ScheduleInput {
  bracketPhase: ScheduleLogicKey;
  poolingPhase: PoolingPhaseKey;
  config: PoolingConfig;
  format: ScheduleFormat;
  roster: string[];
}

/** The rounds and groups of a schedule, or the message of the builder that refused it. */
export type ScheduleRounds = ({ ok: true } & TournamentProgression) | { ok: false; error: string };

/** A setting the stored config holds only for its own bracket phase: that phase's builder refuses it when it is missing. */
function heldForPhase<T>(value: T | undefined): T {
  return value as T;
}

interface CommonGenerationInput {
  poolingPhase: PoolingPhaseKey;
  config: PoolingConfig;
  roster: string[];
}

export function getMinimumBracketUnits(bracketPhase: ScheduleLogicKey, roomSize: RoomSize): number {
  // Waterfall's real floor is enforced precisely against the organiser's own
  // graph (validateAndOrderWaterfallGraph's rule 9, checked in generation.ts)
  // -- this early, generic gate only needs to let any positive count through
  // so that later, more specific error reaches the organiser instead.
  if (bracketPhase === 'waterfall-bracket' || bracketPhase === 'layered') return 1;
  // Two rooms of the smallest size: the floor of an upper and lower bracket (upper-lower.ts).
  if (bracketPhase === 'upper-lower') return 2 * roomSize.min;
  if (bracketPhase === 'double-elimination') return 4;
  // Single elimination's Semis shrinks to who advances, down to two rooms of the smallest size.
  return 2 * (bracketPhase === 'single-elimination' ? roomSize.min : roomSize.ideal);
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

/**
 * Builds the rounds of a schedule: the pooling phase's, then the bracket phase's, with the match formats applied. A
 * builder that refuses its numbers gives its own message as `error`, which each caller words or shows as it did before.
 */
export function buildScheduleRounds(input: ScheduleInput): ScheduleRounds {
  try {
    return { ok: true, ...buildProgression(input) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildProgression(input: ScheduleInput): TournamentProgression {
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
      bracket = sharedFinalDoubleEliminationBracketPhase(pooled.seedTotal, pooled.nextRoundNum, {
        ...input.format,
        lbQualifiers: heldForPhase(input.format.lbQualifiers),
      });
      break;
    case 'kings-valley':
      bracket = kingsValleyBracketPhase(pooled.seedTotal, pooled.nextRoundNum, input.format);
      break;
    case 'waterfall-bracket': {
      const format = { ...input.format, graph: heldForPhase(input.format.graph) };
      bracket = waterfallBracketPhase(pooled.seedTotal, pooled.nextRoundNum, format);
      // The rounds of a bracket the app wrote (upper and lower, layered) play match stages, marked before the formats are applied.
      if (hasAppWrittenMark(format)) bracket = markAppWrittenStages(bracket);
      pooledRounds = withStandingsRoutes(
        pooledRounds,
        waterfallStandingsRoutes(format.graph, pooled.nextRoundNum),
      );
      break;
    }
    case 'upper-lower':
    case 'layered':
      // Only a Setup choice: the tournament it makes is a Custom bracket, whose bracket phase is 'waterfall-bracket'.
      throw new Error(
        'An upper and lower bracket or a layered bracket is built as a Custom bracket, not as a bracket phase of its own.',
      );
  }
  return {
    rounds: applyMatchFormats([...pooledRounds, ...bracket], input.format),
    groups: pooled.groups ?? [],
  };
}
