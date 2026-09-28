export type TournamentWriteInput = {
  payload: unknown;
  tournamentId: string;
};

export const TOURNAMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function validateWriteInput(input: TournamentWriteInput): TournamentWriteInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  const tournamentId = typeof input.tournamentId === 'string' ? input.tournamentId.trim() : '';
  if (!TOURNAMENT_ID_PATTERN.test(tournamentId)) throw new Error('Invalid tournament ID.');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new Error('Invalid tournament data.');
  }
  const payload = { ...(input.payload as Record<string, unknown>) };
  delete payload.adminProof;
  return { tournamentId, payload };
}
