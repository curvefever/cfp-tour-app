import { useRef, useState } from 'react';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { ActiveTab } from '../../domain/tournament/types';

/**
 * The loaded tournament as the screens hold it: its state, the Setup form and the active tab, each with a ref that
 * holds the latest value for the code that runs outside a render.
 */
export function useTournamentStore() {
  const [state, setState] = useState(createDefaultTournamentState);
  const [setup, setSetup] = useState(createDefaultSetup);
  const [activeTab, setActiveTabState] = useState<ActiveTab>('tournaments');
  const stateRef = useRef(state);
  const setupRef = useRef(setup);
  const activeTabRef = useRef(activeTab);
  stateRef.current = state;
  setupRef.current = setup;
  activeTabRef.current = activeTab;

  return {
    state,
    setState,
    setup,
    setSetup,
    activeTab,
    setActiveTabState,
    stateRef,
    setupRef,
    activeTabRef,
  };
}
