import type { ActiveTab, TournamentPhase, TournamentState } from '../../domain/tournament/types';
import { tournamentPhase } from '../tournaments/tournament-lifecycle';
import type { TournamentSummary } from '../tournaments/tournament-summary';

export const TABS: Array<{ key: ActiveTab; label: string }> = [
  { key: 'tournaments', label: 'Tournaments' },
  { key: 'info', label: 'Info' },
  { key: 'admin', label: 'Admin' },
  { key: 'bracket', label: 'Bracket' },
  { key: 'standings', label: 'Standings' },
  { key: 'rankings', label: 'Rankings' },
];

export interface TabContext {
  canAdmin: boolean;
  /** The phase of the loaded tournament; null when none is loaded. */
  phase: TournamentPhase | null;
  /** The name of the standings tab ("Qualification", "Swiss", "Groups"); null without a standings phase. */
  standingsTitle: string | null;
  /** Whether the loaded tournament's schedule has been generated (it has rounds). */
  scheduleDrawn: boolean;
}

/** A tournament has started once it is ongoing, or finished after having been played. */
function hasStarted(phase: TournamentPhase | null): boolean {
  return phase === 'ongoing' || phase === 'finished';
}

/**
 * Whether the draw (Bracket and the standings tab) is shown: to everyone once the tournament has started, and to an
 * admin as soon as the schedule is generated, to check it before Confirm & Start. A viewer never sees a draw before
 * the start.
 */
function showsDraw({ canAdmin, phase, scheduleDrawn }: TabContext): boolean {
  return hasStarted(phase) || (canAdmin && phase !== null && scheduleDrawn);
}

function isAvailable(tab: ActiveTab, context: TabContext): boolean {
  switch (tab) {
    case 'tournaments':
      return true;
    case 'admin':
      return context.canAdmin;
    case 'info':
    case 'rankings':
      return context.phase !== null;
    case 'bracket':
      return showsDraw(context);
    case 'standings':
      return showsDraw(context) && context.standingsTitle !== null;
  }
}

/**
 * The players, listed before the tournament starts, become the rankings from Confirm & Start; the standings tab is
 * named after the pooling phase.
 */
function labelFor(tab: { key: ActiveTab; label: string }, { phase, standingsTitle }: TabContext): string {
  if (tab.key === 'rankings' && !hasStarted(phase)) return 'Players';
  if (tab.key === 'standings') return standingsTitle ?? tab.label;
  return tab.label;
}

export function visibleTabs(context: TabContext): Array<{ key: ActiveTab; label: string }> {
  return TABS.filter((tab) => isAvailable(tab.key, context)).map((tab) => ({
    key: tab.key,
    label: labelFor(tab, context),
  }));
}

/** The tab to display for a stored one. Nothing is written back, so a stored tab that is unavailable now shows a fallback. */
export function effectiveTab(activeTab: ActiveTab, context: TabContext): ActiveTab {
  if (isAvailable(activeTab, context)) return activeTab;
  // A stored Standings tab with no standings phase shows Bracket; anything else shows the tournament's Info, or the list.
  if (activeTab === 'standings' && isAvailable('bracket', context)) return 'bracket';
  return context.phase === null ? 'tournaments' : 'info';
}

/**
 * The phase of the loaded tournament, for the tab rules; null when none is loaded. Until its stored state has
 * arrived the state is only a blank one, so its list entry decides; once it is there the state wins.
 */
export function loadedPhase(input: {
  state: Pick<TournamentState, 'tournamentId' | 'lifecycle' | 'started' | 'info'>;
  summary: TournamentSummary | undefined;
  stateReceived: boolean;
  nowMs: number;
}): TournamentPhase | null {
  const { state, summary, stateReceived, nowMs } = input;
  if (!state.tournamentId) return null;
  if (!stateReceived && summary) return tournamentPhase(summary, nowMs);
  return tournamentPhase(
    {
      status: state.lifecycle?.status ?? 'published',
      started: state.started,
      scheduledAt: state.info?.scheduledAt ?? null,
    },
    nowMs,
  );
}
