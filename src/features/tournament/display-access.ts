/**
 * What the screens read as "admin" and "viewer". An admin who switched on the spectator view is shown everything as a
 * viewer would see it; the sign-in itself, and so every write and the sync, is untouched (`TournamentProvider`).
 */
export interface DisplayAccess {
  /** Shows the admin's controls and tabs. */
  unlocked: boolean;
  /** Shows what a non-admin sees. */
  isViewer: boolean;
  /** An admin is looking at the viewer's page. Never true for a viewer. */
  spectating: boolean;
}

export function displayAccess(canAdmin: boolean, spectating: boolean): DisplayAccess {
  const spectatorView = canAdmin && spectating;
  return {
    unlocked: canAdmin && !spectatorView,
    isViewer: !canAdmin || spectatorView,
    spectating: spectatorView,
  };
}
