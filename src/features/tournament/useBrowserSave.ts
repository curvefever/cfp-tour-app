import { useCallback, useRef } from 'react';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { saveLiveEnvelope } from '../../lib/persistence/storage';

/**
 * Saves the loaded tournament in this browser. `isViewerRef` holds whether the visitor is signed in as a viewer, for
 * the saves made by code that runs outside a render.
 */
export function useBrowserSave(signedInViewer: boolean) {
  const isViewerRef = useRef(signedInViewer);
  isViewerRef.current = signedInViewer;

  const persist = useCallback(
    (nextState: TournamentState, nextSetup: PersistedSetup, nextTab: ActiveTab, viewer = signedInViewer) => {
      if (typeof window === 'undefined') return;
      const result = saveLiveEnvelope(
        window.localStorage,
        { T: nextState, setup: nextSetup, activeTab: nextTab },
        { isViewer: viewer },
      );
      if (result.status === 'failed') {
        console.warn('Could not save tournament state', result.error);
      }
    },
    [signedInViewer],
  );

  return { persist, isViewerRef };
}
