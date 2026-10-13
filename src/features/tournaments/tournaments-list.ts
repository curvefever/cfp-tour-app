import { getGameFormat } from '../../domain/tournament/formats';
import type { TourEnvironment } from '../sync/firebase-paths';
import { isVisibleToViewers, tournamentPhase, type TournamentPhase } from './tournament-lifecycle';
import type { TournamentSummary } from './tournament-summary';

export interface TournamentCard {
  summary: TournamentSummary;
  phase: TournamentPhase;
  /** "37 players" or "12 teams", by the unit of the format. */
  unitLabel: string;
  /** True for an upcoming tournament within the hour before its start. */
  startingSoon: boolean;
}

export interface TournamentSections {
  ongoing: TournamentCard[];
  /** Soonest first. */
  upcoming: TournamentCard[];
  /** Newest first. */
  finished: TournamentCard[];
}

export const EMPTY_SECTION_TEXTS = {
  ongoing: 'No tournament currently ongoing',
  upcoming: 'New tournaments coming out soon!',
  finished: 'No tournament completed yet',
} as const;

/** The count with the unit of the format, in the singular for one: "1 player", "37 players", "12 teams". */
export function unitCountLabel(summary: Pick<TournamentSummary, 'gameFormat' | 'unitCount'>): string {
  const format = getGameFormat(summary.gameFormat);
  const unit = (summary.unitCount === 1 ? format?.unitLabel : format?.unitLabelPlural) ?? 'Players';
  return `${summary.unitCount} ${unit.toLowerCase()}`;
}

/** Soonest first; a tournament with no date comes last. */
function bySchedule(a: TournamentCard, b: TournamentCard): number {
  return (a.summary.scheduledAt ?? Infinity) - (b.summary.scheduledAt ?? Infinity);
}

/**
 * The Tournaments page's sections. A draft has no section, so it is never listed; a viewer sees what `isVisibleToViewers` allows (on
 * production no test run), an admin also sees the test runs.
 */
export function tournamentSections(
  summaries: TournamentSummary[],
  options: { env: TourEnvironment; nowMs: number; isAdmin: boolean },
): TournamentSections {
  const cards = summaries
    .filter((summary) => options.isAdmin || isVisibleToViewers(summary, options.env))
    .map((summary): TournamentCard => {
      const phase = tournamentPhase(summary, options.nowMs);
      return {
        summary,
        phase,
        unitLabel: unitCountLabel(summary),
        startingSoon: phase === 'starting-soon',
      };
    });
  return {
    ongoing: cards.filter((card) => card.phase === 'ongoing').sort(bySchedule),
    upcoming: cards
      .filter((card) => card.phase === 'upcoming' || card.phase === 'starting-soon')
      .sort(bySchedule),
    finished: cards
      .filter((card) => card.phase === 'finished')
      .sort((a, b) => (b.summary.finishedAt ?? 0) - (a.summary.finishedAt ?? 0)),
  };
}
