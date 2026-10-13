import { TOURNAMENT_PHASES, type ActiveTab, type TournamentPhase } from '../../domain/tournament/types';
import type { ExitedMemory, LastView } from '../../lib/persistence/storage';
import type { TourEnvironment } from '../sync/firebase-paths';
import { isVisibleToViewers, tournamentPhase } from './tournament-lifecycle';
import type { TournamentSummary } from './tournament-summary';

export const UNAVAILABLE_NOTICE = "This tournament isn't available.";

/** How long after it finished the most recent tournament still opens by itself, on Rankings. */
export const RECENTLY_FINISHED_MS = 24 * 60 * 60 * 1000;

export interface VisitInput {
  /** The tournament id in the address, if any. */
  urlId: string | null;
  /** Every tournament of this site, as the index lists them. */
  summaries: TournamentSummary[];
  env: TourEnvironment;
  nowMs: number;
  /** What this browser remembers: the last tab with its tournament, and the tournament it exited. */
  memory: { lastView: LastView | null; exited: ExitedMemory | null };
  isAdmin: boolean;
}

export interface VisitResult {
  /** The tournament to load; null opens the Tournaments tab with nothing loaded. */
  tournamentId: string | null;
  tab: ActiveTab;
  /** Shown to the visitor, e.g. when a link points to a tournament they cannot see. */
  notice?: string;
  /** True when the exited tournament has moved on to a later phase, or another tournament is the one that would load: the exit is forgotten. */
  forgetExited?: boolean;
}

/** The tab a tournament opens on, per phase. */
export function landingTab(phase: TournamentPhase): ActiveTab {
  switch (phase) {
    case 'draft':
      return 'admin';
    case 'upcoming':
    case 'starting-soon':
      return 'info';
    case 'ongoing':
      return 'bracket';
    case 'finished':
      return 'rankings';
  }
}

/** The last tab is restored only for the same tournament, and never for a finished one. */
function tabFor(summary: TournamentSummary, lastView: LastView | null, nowMs: number): ActiveTab {
  const phase = tournamentPhase(summary, nowMs);
  const sameTournament =
    lastView !== null && (lastView.tournamentId === null || lastView.tournamentId === summary.id);
  return phase !== 'finished' && sameTournament ? lastView.tab : landingTab(phase);
}

function opens(summary: TournamentSummary, input: VisitInput): VisitResult {
  return { tournamentId: summary.id, tab: tabFor(summary, input.memory.lastView, input.nowMs) };
}

/** Whether `phase` comes after `other` in the life of a tournament. */
function isLater(phase: TournamentPhase, other: TournamentPhase): boolean {
  return TOURNAMENT_PHASES.indexOf(phase) > TOURNAMENT_PHASES.indexOf(other);
}

const NOTHING_LOADED: VisitResult = { tournamentId: null, tab: 'tournaments' };

/** Decides what a visit loads and which tab it opens on, from the address, the tournament list and the memory of this browser. */
export function resolveVisit(input: VisitInput): VisitResult {
  const { urlId, summaries, env, nowMs, memory, isAdmin } = input;
  if (urlId) {
    const linked = summaries.find((summary) => summary.id === urlId);
    const canSee = linked && (isAdmin || isVisibleToViewers(linked, env));
    return canSee ? opens(linked, input) : { ...NOTHING_LOADED, notice: UNAVAILABLE_NOTICE };
  }

  const visible = summaries.filter((summary) => isVisibleToViewers(summary, env));
  const live = visible.filter((summary) => {
    const phase = tournamentPhase(summary, nowMs);
    return phase === 'starting-soon' || phase === 'ongoing';
  });
  if (live.length > 1) return NOTHING_LOADED;
  if (live.length === 1) {
    const [only] = live;
    const { exited } = memory;
    if (exited === null) return opens(only, input);
    // The exit holds while the tournament is in the phase it was exited in; a later phase lets it load again.
    const movedOn = exited.tournamentId !== only.id || isLater(tournamentPhase(only, nowMs), exited.phase);
    return movedOn ? { ...opens(only, input), forgetExited: true } : NOTHING_LOADED;
  }

  const latestFinished = visible
    .filter(
      (summary) =>
        summary.status === 'finished' &&
        summary.finishedAt !== null &&
        nowMs - summary.finishedAt < RECENTLY_FINISHED_MS,
    )
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
  if (latestFinished && memory.exited?.tournamentId !== latestFinished.id)
    return opens(latestFinished, input);
  return NOTHING_LOADED;
}
