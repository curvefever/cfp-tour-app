import type { PersistedSetup } from '../../../domain/tournament/types';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { useSetupNumbering } from './useWaterfallNumbering';

export type SetupKey = keyof PersistedSetup;

/** `updateSetup` for the edits of the Setup form: inside the Setup view they renumber a Custom bracket's default round names when they move the first number. */
export function useSetupUpdate() {
  const { updateSetup } = useTournamentApp();
  return useSetupNumbering()?.updateSetup ?? updateSetup;
}

/** Changes one field of the Setup form. */
export function useSetupChange(): (key: SetupKey, value: string) => void {
  const updateSetup = useSetupUpdate();
  return function change(key: SetupKey, value: string) {
    updateSetup((current) => ({ ...current, [key]: value }));
  };
}
