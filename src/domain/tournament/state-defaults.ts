import { scoringForPooling } from './match-results';
import type { PersistedSetup, TournamentInfo, TournamentLifecycle, TournamentState } from './types';

export function createDefaultTournamentState(overrides: Partial<TournamentState> = {}): TournamentState {
  return {
    title: '',
    players: [],
    reserves: [],
    reserveIndividuals: [],
    confirmations: {},
    confirmedCount: null,
    tournamentId: null,
    rounds: [],
    curRound: 0,
    scores: {},
    finalScores: {},
    assignments: [],
    luckyLosers: [],
    byes: [],
    poolingByeCounts: {},
    roomHistory: {},
    pendingBracketSeeds: {},
    qualTable: [],
    groups: [],
    groupStandings: {},
    tieResolutions: {},
    absences: {},
    backFromAbsence: {},
    waterfallSteps: [],
    defenderChanges: {},
    withdrawnUnits: [],
    anonymousFinalists: [],
    reserveOpen: true,
    started: false,
    cfg: {},
    scheduleLogic: 'single-elimination',
    gameFormat: 'ffa-individual',
    gamemodeConfig: {},
    ...overrides,
  };
}

/** What choosing a qualification table puts in: 4 rounds, the first not counted. */
export const USUAL_QUAL_TABLE_VALUES = { qualRoundsOverride: '4', nonCountingRounds: '1' } as const;

/** What choosing a Swiss puts in: 5 rounds, all counted. */
export const USUAL_SWISS_VALUES = { swissRoundsOverride: '5', nonCountingRounds: '0' } as const;

/**
 * Every field of the Setup form at its plain default. It also fills the keys a stored setup or a stored tournament's
 * settings lack, so a change here changes tournaments that exist; a new tournament starts from `newTournamentSetup`.
 */
export function createDefaultSetup(overrides: Partial<PersistedSetup> = {}): PersistedSetup {
  return {
    scheduleLogic: 'single-elimination',
    gameFormat: 'ffa-individual',
    scoring: 'fairpoints',
    positionalPointsTable: '',
    matchResultPoints: '3, 2, 1, 0',
    tieMargin: '',
    drawPublication: 'adaptive',
    poolingPhase: 'none',
    qualAdv: '24',
    nonCountingRounds: '0',
    groupSize: '4',
    roundRobinMode: 'single',
    qualifiersPerGroup: '2',
    groupExit: 'per-group',
    finalsGames: '3',
    semisGames: '1',
    finalsBestOf: '',
    semisBestOf: '',
    poolingGames: '1',
    poolingBestOf: '',
    bracketGames: '1',
    bracketBestOf: '',
    losersGames: '1',
    losersBestOf: '',
    matchOverrides: '',
    grandFinalWbTarget: '2',
    grandFinalLbTarget: '3',
    semisOverride: '',
    finalOverride: '',
    qualRoundsOverride: '',
    swissRoundsOverride: '',
    eliminationRoundTargets: '',
    eliminationSeedingOverrides: '',
    waterfallGraph: '',
    waterfallNumberedFrom: '',
    upperLowerAdvance: '',
    upperLowerUpper: '',
    finalsUnevenWins: '',
    finalsUpperWins: '',
    finalsLowerWins: '',
    layeredExpected: '',
    layeredInBracket: '',
    layeredRounds: '',
    layeredLevels: '',
    layeredTop: '',
    layeredTopCounts: '',
    layeredSemiOthers: '',
    oddCountStrategy: '',
    teamScoringRule: '',
    roster: '',
    reserves: '',
    reserveIndividuals: '',
    ...overrides,
  };
}

/**
 * The Setup form of a brand-new tournament only: the organiser's usual choices, a qualification table of 4 rounds with
 * the first not counted, and "Advance to bracket" left to the app. `createDefaultSetup` stays what fills the keys
 * missing from stored data.
 */
export function newTournamentSetup(): PersistedSetup {
  const defaults = createDefaultSetup();
  const { scoring, gameFormat, oddCountStrategy } = defaults;
  return {
    ...defaults,
    poolingPhase: 'qual-table',
    qualAdv: '',
    ...USUAL_QUAL_TABLE_VALUES,
    scoring: scoringForPooling(scoring, 'qual-table', gameFormat, oddCountStrategy),
  };
}

export function createDefaultInfo(overrides: Partial<TournamentInfo> = {}): TournamentInfo {
  return { scheduledAt: null, rulesText: '', screenshots: [], ...overrides };
}

export function createDefaultLifecycle(overrides: Partial<TournamentLifecycle> = {}): TournamentLifecycle {
  return { status: 'draft', testRun: false, createdAt: 0, finishedAt: null, ...overrides };
}
