import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ActiveTab } from '../../domain/tournament/types';
import type { useAuth } from '../auth/AuthProvider';
import { displayAccess } from './display-access';

/**
 * What the screens may show of the admin's: the access they read, the spectator view that turns it into a viewer's,
 * and entering and locking the admin view. Display only: saving and sync follow the sign-in.
 */
export function useAdminLock(
  auth: ReturnType<typeof useAuth>,
  unloadTournament: () => Promise<void>,
  setActiveTabState: Dispatch<SetStateAction<ActiveTab>>,
) {
  const [spectatorView, setSpectatorView] = useState(false);
  const access = displayAccess(auth.canAdmin, spectatorView);

  // Only a signed-in admin can look at the spectator view, and signing out ends it.
  const setSpectating = useCallback((on: boolean) => setSpectatorView(auth.canAdmin && on), [auth.canAdmin]);
  useEffect(() => {
    if (!auth.canAdmin) setSpectatorView(false);
  }, [auth.canAdmin]);

  const unlockAdmin = useCallback(() => {
    setActiveTabState('admin');
  }, []);
  const lockAdmin = useCallback(() => {
    auth.logout();
    void unloadTournament();
    setActiveTabState('tournaments');
  }, [auth, unloadTournament]);

  return { access, setSpectating, unlockAdmin, lockAdmin };
}
