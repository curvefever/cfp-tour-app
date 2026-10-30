import { withFormMatchFormats, type MatchSettings } from '../../../domain/tournament/round-match-formats';
import { useTournamentApp } from '../../tournament/TournamentProvider';

/**
 * Changes some match format settings of the Setup form. A schedule already drawn (and not started) is played in
 * them at once, so the preview shows them without generating again.
 */
export function useMatchSettingsChange(): (patch: Partial<MatchSettings>) => void {
  const { setup, state, updateSetup, updateState } = useTournamentApp();
  return function change(patch) {
    updateSetup((current) => ({ ...current, ...patch }));
    if (state.rounds.length > 0 && !state.started) {
      updateState((current) => withFormMatchFormats(current, { ...setup, ...patch }));
    }
  };
}
