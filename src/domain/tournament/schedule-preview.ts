import { getGameFormat } from './formats';
import { generateTournamentWithPlan, type GenerationWithPlanResult } from './generation';
import type { GenerationForm } from './generation-plan-types';
import { rosterKeys } from './roster';
import { createTournamentRuntime, type TournamentRuntime } from './runtime';
import { createDefaultTournamentState } from './state-defaults';
import type { GameFormatKey, TournamentRoster, TournamentState } from './types';

/**
 * The schedule the Setup form would generate for a head count, before Generate. It is generation itself, so it cannot
 * differ from what Generate builds: on the loaded roster for its own count, else on a roster of stand-ins. Nothing is
 * stored.
 */
export type SchedulePreview = GenerationWithPlanResult;

/** A runtime that gives the same draw every time, so a preview worked out again looks the same. */
export function previewRuntime(): TournamentRuntime {
  let seed = 1;
  return createTournamentRuntime({
    clock: { now: () => 0 },
    random: {
      next: () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      },
    },
    ids: {
      tournamentId: () => 'preview',
      rosterUnitId: (prefix, index) => `preview_${prefix}_${index}`,
    },
  });
}

/** `count` units of the shape the game format takes: full teams of its size, or plain names. */
function standInRoster(gameFormat: GameFormatKey, count: number): TournamentRoster {
  const teamSize = getGameFormat(gameFormat)?.teamSize;
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  if (!teamSize) return numbers.map((number) => `Player ${number}`);
  return numbers.map((number) => ({
    teamId: `stand-in-${number}`,
    teamName: `Team ${number}`,
    members: Array.from({ length: teamSize }, (_, slot) => ({ name: `Player ${number}-${slot + 1}` })),
  }));
}

/** A tournament with nothing but a loaded roster of `count` stand-ins. */
export function standInRosterState(gameFormat: GameFormatKey, count: number): TournamentState {
  return createDefaultTournamentState({
    gameFormat,
    players: standInRoster(gameFormat, count),
    confirmedCount: count,
  });
}

export function previewSchedule(
  current: TournamentState,
  form: GenerationForm,
  unitCount: number,
  runtime: TournamentRuntime,
): SchedulePreview {
  // As generation reads it: null and a missing count both mean that no roster is loaded.
  const isLoaded = current.confirmedCount !== null && current.confirmedCount !== undefined;
  const isLoadedCount = isLoaded && unitCount === rosterKeys(current.players).length;
  const state = isLoadedCount ? current : standInRosterState(form.gameFormat, unitCount);
  return generateTournamentWithPlan(state, form, runtime);
}
