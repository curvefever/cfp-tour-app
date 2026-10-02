import { parseAdvanceToBracket } from './bracket-entry';
import { parseEliminationTargets } from './elimination-targets';
import { getGameFormat } from './formats';
import { fitRoundToPool, splitAdvancement, validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { buildTournamentProgression, getMinimumBracketUnits } from './schedule-generation';
import { eliminationRound } from './single-elimination';
import type { MaterializedGamemodeConfig, TournamentRound, TournamentState } from './types';
import type { TournamentProgressionInput } from './schedule-generation';

/**
 * Live corrections to how many units survive each elimination round (and the
 * "Advance to bracket" cut while pooling still runs). Two shapes:
 *
 * - pooling: nothing of the bracket exists yet, so the bracket is rebuilt
 *   from scratch exactly like Setup does (list length included, blank =
 *   automatic); pooling rounds are never touched.
 * - bracket (single elimination only): values only -- the number of
 *   remaining elimination rounds doesn't change.
 *
 * `advancementEditScope` tells the UI what is editable now so it never
 * re-derives the rules.
 */

export type AdvancementScope =
  | {
      kind: 'pooling';
      qualAdvEditable: boolean;
      qualAdv: number;
      /** Smallest / largest accepted "Advance to bracket". */
      minQualAdv: number;
      maxQualAdv: number;
      /** The explicit targets in force, comma-separated; blank = automatic. */
      targetsText: string;
    }
  | {
      kind: 'bracket';
      rounds: Array<{ index: number; label: string; players: number; advTotal: number }>;
      semisSize: number;
    }
  | { kind: 'none'; reason: string };

export type AdvancementEditInput =
  { kind: 'pooling'; qualAdv: string; targetsText: string } | { kind: 'bracket'; targets: number[] };

export type AdvancementEditResult = { ok: true; state: TournamentState } | { ok: false; error: string };

const EDITABLE_SCHEDULES = ['single-elimination', 'double-elimination-shared-final'];

const isPoolingRound = (round: TournamentRound) => round.isQual || !!round.isSwiss || round.isNoElim;

const isEliminationRound = (round: TournamentRound) =>
  !isPoolingRound(round) && !round.isSemis && !round.isFinal && !round.isGroupStage;

function firstBracketIndex(rounds: TournamentRound[]): number {
  return rounds.findIndex((round) => !isPoolingRound(round));
}

function none(reason: string): AdvancementScope {
  return { kind: 'none', reason };
}

function qualAdvBounds(state: TournamentState): { min: number; max: number } | null {
  const roomSize = state.gamemodeConfig.roomSize;
  if (!roomSize) return null;
  return {
    min: getMinimumBracketUnits(state.scheduleLogic, roomSize),
    max: rosterKeys(state.players).length,
  };
}

export function advancementEditScope(state: TournamentState): AdvancementScope {
  if (!state.started) return none('The tournament has not started.');
  if (!EDITABLE_SCHEDULES.includes(state.scheduleLogic)) {
    return none("This bracket format's advancement counts can't be edited during play.");
  }
  if (state.cfg.poolingPhase === 'group-stage') return none("Group stage advancement can't be edited.");
  const current = state.rounds[state.curRound];
  if (!current) return none('There is no current round.');

  if (isPoolingRound(current)) {
    const bounds = qualAdvBounds(state);
    if (!bounds) return none('This tournament is missing its room size.');
    const pooling = state.cfg.poolingPhase;
    return {
      kind: 'pooling',
      qualAdvEditable: pooling === 'qual-table' || pooling === 'swiss',
      qualAdv: state.cfg.qualAdv ?? bounds.max,
      minQualAdv: bounds.min,
      maxQualAdv: bounds.max,
      targetsText: state.gamemodeConfig.explicitTargets?.join(',') ?? '',
    };
  }
  if (state.scheduleLogic !== 'single-elimination') {
    return none('Shared-Final double elimination advancement can only be edited before its bracket starts.');
  }
  if (!isEliminationRound(current)) return none('Semis and the Final have fixed sizes.');
  const semisIndex = state.rounds.findIndex((round) => round.isSemis);
  const rounds = state.rounds.slice(state.curRound, semisIndex).map((round, offset) => ({
    index: state.curRound + offset,
    label: `Round ${round.roundNum}`,
    players: round.players,
    advTotal: round.advTotal,
  }));
  return { kind: 'bracket', rounds, semisSize: state.gamemodeConfig.semisSize ?? 0 };
}

/** The elimination rounds' advTotals, played ones included: what "Copy settings" should reproduce. */
function eliminationTargetList(rounds: TournamentRound[]): number[] {
  return rounds.filter(isEliminationRound).map((round) => round.advTotal);
}

function syncSettings(
  state: TournamentState,
  targets: number[] | undefined,
  qualAdv: number | undefined,
): Pick<TournamentState, 'settings' | 'gamemodeConfig'> {
  const { explicitTargets: _previous, ...rest } = state.gamemodeConfig;
  const gamemodeConfig = targets ? { ...rest, explicitTargets: targets } : rest;
  const settings = state.settings && {
    ...state.settings,
    eliminationRoundTargets: targets?.join(',') ?? '',
    ...(qualAdv !== undefined ? { qualAdv: String(qualAdv) } : {}),
  };
  return { gamemodeConfig, settings };
}

function parseQualAdv(text: string, bounds: { min: number; max: number }): number | string {
  const value = parseAdvanceToBracket(text);
  if (value === null || String(value) !== text.trim()) {
    return `Advance to bracket must be a positive whole number — got "${text}".`;
  }
  if (value < bounds.min || value > bounds.max) {
    return `Advance to bracket must be between ${bounds.min} and ${bounds.max} (the format's minimum and the number of units in the tournament) — got ${value}.`;
  }
  return value;
}

function applyPoolingEdit(
  state: TournamentState,
  input: Extract<AdvancementEditInput, { kind: 'pooling' }>,
  scope: Extract<AdvancementScope, { kind: 'pooling' }>,
): AdvancementEditResult {
  const config = state.gamemodeConfig as MaterializedGamemodeConfig;
  const format = getGameFormat(state.gameFormat);
  if (!format || !config.roomSize) return { ok: false, error: 'This tournament is missing its room size.' };

  let qualAdv = scope.qualAdv;
  if (scope.qualAdvEditable) {
    const parsed = parseQualAdv(input.qualAdv, { min: scope.minQualAdv, max: scope.maxQualAdv });
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    qualAdv = parsed;
  }
  const poolingPhase = state.cfg.poolingPhase ?? 'none';
  const entryCount = poolingPhase === 'none' ? scope.maxQualAdv : qualAdv;
  const lbQualifiers = config.lbQualifiers ?? 0;
  const parsedTargets = parseEliminationTargets(input.targetsText, {
    schedule: state.scheduleLogic,
    bracketEntryCount: entryCount,
    entryLabel:
      poolingPhase === 'none' ? 'number of units in the tournament' : 'number advancing to the bracket',
    semisSize: config.semisSize,
    winnersQualifiers: config.finalSize - lbQualifiers,
    finalSize: config.finalSize,
    lbQualifiers,
  });
  if (!parsedTargets.ok) return { ok: false, error: parsedTargets.error };
  const targets = parsedTargets.values;
  const seedingOverrides = config.explicitSeedingOverrides;
  if (seedingOverrides && targets?.length !== seedingOverrides.length) {
    return {
      ok: false,
      error: `This tournament has elimination seeding overrides for ${seedingOverrides.length} rounds, index-aligned with the targets, so the targets list must keep exactly ${seedingOverrides.length} entries.`,
    };
  }

  const cfg = { ...state.cfg, qualAdv };
  const synced = syncSettings({ ...state, cfg }, targets, scope.qualAdvEditable ? qualAdv : undefined);
  const gamemodeConfig = synced.gamemodeConfig as MaterializedGamemodeConfig;
  const roster = rosterKeys(state.players);
  let progression;
  try {
    progression = buildTournamentProgression({
      bracketPhase: config.bracketPhase,
      poolingPhase,
      config: {
        n: roster.length,
        qualAdv,
        groupSize: cfg.groupSize ?? 4,
        roundRobinMode: cfg.roundRobinMode ?? 'single',
        qualifiersPerGroup: cfg.qualifiersPerGroup ?? 2,
      },
      format: gamemodeConfig,
      roster,
    } as TournamentProgressionInput);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const bracketStart = firstBracketIndex(state.rounds);
  const rounds = [...state.rounds.slice(0, bracketStart), ...progression.rounds.slice(bracketStart)];
  const roomCapError = validateRoomCap(rounds, format);
  if (roomCapError) return { ok: false, error: roomCapError };
  if (!rounds.every((round) => round.advPerRoom === null || round.advTotal <= round.players)) {
    return { ok: false, error: 'Those numbers leave an elimination round keeping more units than reach it.' };
  }
  // The standings-cutoff tie is keyed plainly and judged by count only, so a
  // resolution made for the old cut line would wrongly satisfy a new one.
  const { 'qual-cutoff': staleCutoff, ...keptTies } = state.tieResolutions;
  const tieResolutions =
    qualAdv === scope.qualAdv || staleCutoff === undefined ? state.tieResolutions : keptTies;
  const emptyTail = () => Array.from({ length: rounds.length - bracketStart }, (): string[] => []);
  return {
    ok: true,
    state: {
      ...state,
      ...synced,
      cfg,
      rounds,
      tieResolutions,
      assignments: state.assignments.slice(0, state.curRound + 1),
      byes: [...state.byes.slice(0, bracketStart), ...emptyTail()],
      luckyLosers: [...state.luckyLosers.slice(0, bracketStart), ...emptyTail()],
      needsSave: true,
    },
  };
}

function validateBracketTargets(
  targets: number[],
  scope: Extract<AdvancementScope, { kind: 'bracket' }>,
  current: TournamentRound,
): string | null {
  if (targets.length !== scope.rounds.length) {
    return `Enter exactly ${scope.rounds.length} value${scope.rounds.length === 1 ? '' : 's'}, one per remaining elimination round — got ${targets.length}.`;
  }
  if (targets.some((value) => !Number.isInteger(value) || value < 1)) {
    return 'Advancement counts must be positive whole numbers.';
  }
  if (targets[0] < current.byeCount || targets[0] > current.players) {
    return `This round's count must be between ${current.byeCount} and ${current.players}.`;
  }
  for (let index = 1; index < targets.length; index += 1) {
    if (targets[index] > targets[index - 1]) {
      return `Advancement counts must not increase from round to round — got ${targets.join(',')}.`;
    }
  }
  const last = targets[targets.length - 1];
  if (last < scope.semisSize) {
    return `The last advancement count (${last}) must be at least ${scope.semisSize} (the Semis size).`;
  }
  return null;
}

function applyBracketEdit(
  state: TournamentState,
  targets: number[],
  scope: Extract<AdvancementScope, { kind: 'bracket' }>,
): AdvancementEditResult {
  const config = state.gamemodeConfig as MaterializedGamemodeConfig;
  const current = state.rounds[state.curRound];
  const invalid = validateBracketTargets(targets, scope, current);
  if (invalid) return { ok: false, error: invalid };

  const rounds = [...state.rounds];
  rounds[state.curRound] = {
    ...current,
    advTotal: targets[0],
    ...splitAdvancement(targets[0], current.byeCount, current.rooms.length),
  };
  for (let offset = 1; offset < targets.length; offset += 1) {
    const index = state.curRound + offset;
    rounds[index] = eliminationRound(
      targets[offset - 1],
      targets[offset],
      rounds[index].roundNum,
      config,
      rounds[index].seedingOverride,
    );
  }
  const semisIndex = state.curRound + targets.length;
  const fitted = fitRoundToPool(rounds[semisIndex], targets[targets.length - 1], config.roomSize);
  if ('error' in fitted) return { ok: false, error: fitted.error };
  rounds[semisIndex] = fitted;

  return {
    ok: true,
    state: {
      ...state,
      ...syncSettings(state, eliminationTargetList(rounds), undefined),
      rounds,
      needsSave: true,
    },
  };
}

export function applyAdvancementEdit(
  state: TournamentState,
  input: AdvancementEditInput,
): AdvancementEditResult {
  const scope = advancementEditScope(state);
  if (scope.kind === 'none') return { ok: false, error: scope.reason };
  if (scope.kind === 'pooling' && input.kind === 'pooling') return applyPoolingEdit(state, input, scope);
  if (scope.kind === 'bracket' && input.kind === 'bracket')
    return applyBracketEdit(state, input.targets, scope);
  return { ok: false, error: 'The tournament moved to a different phase — reopen the panel and try again.' };
}
