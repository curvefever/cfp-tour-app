import { useTournamentApp } from './TournamentProvider';

/** The loaded tournament's name: its own title, else its list entry's (before its state has arrived), else a placeholder. */
export function useTournamentTitle(): string {
  const { state, tournaments } = useTournamentApp();
  const summary = tournaments.summaries.find((entry) => entry.id === state.tournamentId);
  return state.title.trim() || summary?.title.trim() || 'Unnamed Tournament';
}
