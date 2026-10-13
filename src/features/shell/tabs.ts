import type { ActiveTab } from '../../domain/tournament/types';
import type { TournamentPhase } from '../tournaments/tournament-lifecycle';

export const TABS: Array<{ key: ActiveTab; label: string }> = [
  { key: 'tournaments', label: '🗓 Tournaments' },
  { key: 'info', label: 'ℹ Info' },
  { key: 'admin', label: '⚙ Admin' },
  { key: 'bracket', label: '🗂 Bracket' },
  { key: 'standings', label: '📊 Standings' },
  { key: 'rankings', label: '🏆 Rankings' },
];

export interface TabContext {
  canAdmin: boolean;
  /** The phase of the loaded tournament; null when none is loaded. */
  phase: TournamentPhase | null;
  showStandings: boolean;
}

/** A tournament has started once it is ongoing, or finished after having been played. */
function hasStarted(phase: TournamentPhase | null): boolean {
  return phase === 'ongoing' || phase === 'finished';
}

function isAvailable(tab: ActiveTab, { canAdmin, phase, showStandings }: TabContext): boolean {
  switch (tab) {
    case 'tournaments':
      return true;
    case 'admin':
      return canAdmin;
    case 'info':
    case 'rankings':
      return phase !== null;
    case 'bracket':
      return hasStarted(phase);
    case 'standings':
      return hasStarted(phase) && showStandings;
  }
}

/** The players, listed before the tournament starts, become the rankings from Confirm & Start. */
function labelFor(tab: { key: ActiveTab; label: string }, phase: TournamentPhase | null): string {
  return tab.key === 'rankings' && !hasStarted(phase) ? '👥 Players' : tab.label;
}

export function visibleTabs(context: TabContext): Array<{ key: ActiveTab; label: string }> {
  return TABS.filter((tab) => isAvailable(tab.key, context)).map((tab) => ({
    key: tab.key,
    label: labelFor(tab, context.phase),
  }));
}

/** The tab to display for a stored one. Nothing is written back, so a stored tab that is unavailable now shows a fallback. */
export function effectiveTab(activeTab: ActiveTab, context: TabContext): ActiveTab {
  if (isAvailable(activeTab, context)) return activeTab;
  // A stored Standings tab with no standings phase shows Bracket; anything else shows the tournament's Info, or the list.
  if (activeTab === 'standings' && isAvailable('bracket', context)) return 'bracket';
  return context.phase === null ? 'tournaments' : 'info';
}
