import type { PersistedSetup } from '../../../domain/tournament/types';
import { useTournamentApp } from '../../tournament/TournamentProvider';

export type SetupKey = keyof PersistedSetup;

/** Changes one field of the Setup form. */
export function useSetupChange(): (key: SetupKey, value: string) => void {
  const { updateSetup } = useTournamentApp();
  return function change(key: SetupKey, value: string) {
    updateSetup((current) => ({ ...current, [key]: value }));
  };
}
