import { staleDrawRefusal } from '../../domain/tournament/pre-start-roster';
import { normalizeLiveTournamentState } from '../../lib/persistence/live-state';
import { unmarshalFromFirebase } from '../sync/firebase-marshal';
import { applyPatchToStored } from '../sync/tournament-patch';

/**
 * The stale-draw refusal for a start, judged on what the database will hold once the start's patch is applied:
 * the patch carries the starting tab's unsent edits, which may change the roster or the draw.
 */
export function startDrawRefusal(
  stored: unknown,
  patch: Record<string, unknown>,
  tournamentId: string,
): string | null {
  const state = normalizeLiveTournamentState(unmarshalFromFirebase(applyPatchToStored(stored, patch)), {
    tournamentId: () => tournamentId,
  });
  return staleDrawRefusal(state);
}
