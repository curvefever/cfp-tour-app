import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { cleanPatchPaths, validateTournamentId } from '../sync/tournament-write.shared';

export type CreateTournamentInput = {
  tournamentId: string;
  state: TournamentState;
  setup: PersistedSetup;
  testRun: boolean;
};

/** A status change, optionally with the patch that goes in the same update (e.g. the cleared rounds). */
export type TransitionInput = {
  tournamentId: string;
  patch?: Record<string, unknown>;
};

export type StartTournamentInput = {
  tournamentId: string;
  patch: Record<string, unknown>;
};

export type TestRunInput = {
  tournamentId: string;
  testRun: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanSetup(value: unknown): PersistedSetup {
  if (!isRecord(value)) throw new Error('Invalid setup.');
  const defaults = createDefaultSetup();
  const setup: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') throw new Error(`Invalid value for setup field: ${key}`);
    setup[key] = value[key];
  }
  return setup as unknown as PersistedSetup;
}

export function validateCreateInput(input: CreateTournamentInput): CreateTournamentInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!isRecord(input.state) || !Array.isArray(input.state.players))
    throw new Error('Invalid tournament data.');
  const state = { ...input.state } as Record<string, unknown>;
  delete state.adminProof;
  return {
    tournamentId,
    state: state as unknown as TournamentState,
    setup: cleanSetup(input.setup),
    testRun: input.testRun === true,
  };
}

export function validateTransitionInput(input: TransitionInput): TransitionInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  return input.patch === undefined ? { tournamentId } : { tournamentId, patch: cleanPatchPaths(input.patch) };
}

export function validateStartInput(input: StartTournamentInput): StartTournamentInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  const patch = cleanPatchPaths(input.patch);
  if (!Object.keys(patch).length) throw new Error('Invalid tournament patch.');
  return { tournamentId, patch };
}

export function validateTestRunInput(input: TestRunInput): TestRunInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  if (typeof input.testRun !== 'boolean') throw new Error('Invalid test-run mark.');
  return { tournamentId: validateTournamentId(input.tournamentId), testRun: input.testRun };
}
