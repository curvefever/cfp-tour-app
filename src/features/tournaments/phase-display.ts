import type { TournamentPhase } from './tournament-lifecycle';

export const PHASE_LABELS: Record<TournamentPhase, string> = {
  draft: 'Draft',
  upcoming: 'Upcoming',
  'starting-soon': 'Starting soon',
  ongoing: 'Ongoing',
  finished: 'Finished',
};

export const PHASE_TONES: Record<TournamentPhase, 'neutral' | 'primary' | 'warning' | 'success'> = {
  draft: 'neutral',
  upcoming: 'primary',
  'starting-soon': 'warning',
  ongoing: 'success',
  finished: 'neutral',
};

export type PillTone = 'now' | 'warning' | 'success' | 'neutral';

/** The status pill of the organiser screens, by phase: a published tournament that has not started reads "Published". */
export const ADMIN_STATUS_PILLS: Record<TournamentPhase, { label: string; tone: PillTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  upcoming: { label: 'Published', tone: 'success' },
  'starting-soon': { label: 'Starting soon', tone: 'warning' },
  ongoing: { label: 'Ongoing', tone: 'now' },
  finished: { label: 'Finished', tone: 'neutral' },
};
