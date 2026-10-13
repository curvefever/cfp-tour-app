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
