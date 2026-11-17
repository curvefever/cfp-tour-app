import type { TournamentState } from './types';

/** The parts of a tournament that a drawn schedule fills, and that play adds to. */
export type ScheduleParts = Pick<
  TournamentState,
  | 'rounds'
  | 'curRound'
  | 'started'
  | 'gamemodeConfig'
  | 'groups'
  | 'groupStandings'
  | 'qualTable'
  | 'assignments'
  | 'luckyLosers'
  | 'byes'
  | 'poolingByeCounts'
  | 'roomHistory'
  | 'pendingBracketSeeds'
  | 'scores'
  | 'finalScores'
  | 'tieResolutions'
  | 'absences'
  | 'backFromAbsence'
  | 'waterfallSteps'
  | 'defenderChanges'
  | 'anonymousFinalists'
>;

/**
 * "An empty schedule": every part a drawn schedule sets, with the value it has before anything is drawn. A new
 * object each call, because the generator writes into the draw of round 1 afterwards.
 *
 * The roster, the reserves, the confirmations, the withdrawals, the Setup (`cfg`, `scheduleLogic`, `gameFormat`,
 * `settings`), the lifecycle and the info are not parts of a schedule. Each caller says beside its call which of
 * the parts below it keeps, and what else it handles itself.
 */
export function emptySchedule(): ScheduleParts {
  return {
    rounds: [],
    curRound: 0,
    started: false,
    gamemodeConfig: {},
    groups: [],
    groupStandings: {},
    qualTable: [],
    assignments: [],
    luckyLosers: [],
    byes: [],
    poolingByeCounts: {},
    roomHistory: {},
    pendingBracketSeeds: {},
    scores: {},
    finalScores: {},
    tieResolutions: {},
    absences: {},
    backFromAbsence: {},
    waterfallSteps: [],
    defenderChanges: {},
    anonymousFinalists: [],
  };
}
