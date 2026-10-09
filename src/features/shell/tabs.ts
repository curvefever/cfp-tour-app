import type { ActiveTab } from '../../domain/tournament/types';

export const TABS: Array<{ key: ActiveTab; label: string }> = [
  { key: 'home', label: '🏠 Home' },
  { key: 'admin', label: '⚙ Admin' },
  { key: 'bracket', label: '🗂 Bracket' },
  { key: 'standings', label: '📊 Standings' },
  { key: 'rankings', label: '🏆 Rankings' },
  { key: 'archive', label: '🗄 Archive' },
];

interface TabContext {
  canAdmin: boolean;
  showStandings: boolean;
}

export function visibleTabs({ canAdmin, showStandings }: TabContext) {
  return TABS.filter(
    (tab) => (tab.key !== 'admin' || canAdmin) && (tab.key !== 'standings' || showStandings),
  );
}

/** The tab to display for a stored one. Nothing is written back, so a stored tab that is unavailable now shows a fallback. */
export function effectiveTab(activeTab: ActiveTab, { canAdmin, showStandings }: TabContext): ActiveTab {
  // A stored 'admin' tab without a session shows Home, and a stored 'standings' tab with no standings phase shows Bracket.
  if (activeTab === 'admin' && !canAdmin) return 'home';
  return activeTab === 'standings' && !showStandings ? 'bracket' : activeTab;
}
