import {
  confirmationSource,
  rosterConfirmationSummary,
  scoredPlayers,
  teamConfirmation,
  type ConfirmationSource,
  type RosterConfirmationSummary,
  type TeamConfirmation,
} from '../../domain/tournament/confirmations';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';

/** What the organiser tools show about confirmations; every status read in the components goes through it. */
export interface ConfirmationView {
  source: (name: string) => ConfirmationSource;
  team: (team: TournamentTeam) => TeamConfirmation;
  summary: RosterConfirmationSummary;
}

/** Built once per render of a tools panel and passed down: the scored names are worked out here, not by each row. */
export function confirmationView(state: TournamentState): ConfirmationView {
  const scored = scoredPlayers(state);
  return {
    source: (name) => confirmationSource(state, name, scored),
    team: (team) => teamConfirmation(state, team, scored),
    summary: rosterConfirmationSummary(state, scored),
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
