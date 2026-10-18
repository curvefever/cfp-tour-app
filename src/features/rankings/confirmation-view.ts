import {
  isConfirmed,
  rosterConfirmationSummary,
  teamConfirmation,
  type RosterConfirmationSummary,
  type TeamConfirmation,
} from '../../domain/tournament/confirmations';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';

/** What the organiser tools show about confirmations; every status read in the components goes through it. */
export interface ConfirmationView {
  isConfirmed: (name: string) => boolean;
  team: (team: TournamentTeam) => TeamConfirmation;
  summary: RosterConfirmationSummary;
}

/** Built once per render of a tools panel and passed down, so no row works anything out for itself. */
export function confirmationView(state: TournamentState): ConfirmationView {
  return {
    isConfirmed: (name) => isConfirmed(state, name),
    team: (team) => teamConfirmation(state, team),
    summary: rosterConfirmationSummary(state),
  };
}

/** The muted count in a panel header: "24 of 37 confirmed", or "9 of 13 teams confirmed · 31 of 39 players". */
export function confirmationCountText(summary: RosterConfirmationSummary): string {
  if (summary.teams === undefined) return `${summary.confirmed} of ${summary.total} confirmed`;
  return `${summary.teamsConfirmed} of ${summary.teams} teams confirmed · ${summary.confirmed} of ${summary.total} players`;
}

/** What a screen reader hears for a team's dot. */
export function teamConfirmationText({ confirmed, level, total }: TeamConfirmation): string {
  if (level === 'all') return 'all confirmed';
  if (level === 'none') return 'none confirmed';
  return `${confirmed} of ${total} confirmed`;
}
