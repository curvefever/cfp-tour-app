import { validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { buildScheduleRounds, type ScheduleRounds } from './schedule-generation';
import { planTournament } from './generation-plan';
import { startTournament } from './generation-start';
import type { GenerationForm, TournamentPlan } from './generation-plan-types';
import type { TournamentRuntime } from './runtime';
import type { TournamentState } from './types';

type GenerateTournamentResult =
  { status: 'generated'; state: TournamentState } | { status: 'invalid'; message: string };

function generationError(message: string): GenerateTournamentResult {
  return { status: 'invalid', message };
}

/** The rounds of the plan for this roster, or why they can't be played. */
function buildRounds(plan: TournamentPlan, roster: string[]): ScheduleRounds {
  const { schedule, config, gamemodeConfig, format, matchResults } = plan;
  const progression = buildScheduleRounds({
    bracketPhase: schedule,
    poolingPhase: config.poolingPhase,
    config,
    format: gamemodeConfig,
    roster,
  });
  if (!progression.ok) return progression;
  const roomCapError = validateRoomCap(progression.rounds, format);
  if (roomCapError) return { ok: false, error: roomCapError };
  if (matchResults) {
    const longMatch = progression.rounds.find(
      (round) => (round.isGroupStage || round.isQual || round.isSwiss) && (round.bestOf ?? 0) > 3,
    );
    if (longMatch) {
      return {
        ok: false,
        error: `Match results scoring can't score a Best of ${longMatch.bestOf} ${longMatch.isGroupStage ? 'group' : 'pooling'} round yet — use a Best of 3, summed games, or another scoring system.`,
      };
    }
  }

  return progression;
}

export function generateTournament(
  current: TournamentState,
  form: GenerationForm,
  runtime: TournamentRuntime,
): GenerateTournamentResult {
  const planned = planTournament(form, current);
  if (!planned.ok) return generationError(planned.message);

  const roster = rosterKeys(current.players);
  const progression = buildRounds(planned.plan, roster);
  if (!progression.ok) return generationError(progression.error);

  const state = startTournament(planned.plan, progression, current, form, runtime);
  return { status: 'generated', state };
}
