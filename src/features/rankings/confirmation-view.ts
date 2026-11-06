import { bracketRoundLabels } from '../../domain/tournament/bracket';
import {
  confirmationSource,
  rosterConfirmationSummary,
  scoredPlayers,
  teamConfirmation,
  type ConfirmationSource,
  type RosterConfirmationSummary,
  type TeamConfirmation,
} from '../../domain/tournament/confirmations';
import { absenceMarks } from '../../domain/tournament/likely-absentees';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { destinationLabel } from '../bracket/exit-text';

/** What a toggle shows: why the name is confirmed (null: not), and for a likely absentee or a back mark the round it answers. */
export interface ToggleMark {
  source: ConfirmationSource;
  /** "Round 2", named as the Bracket names it: the round a likely absentee was absent from, or a back mark answers. */
  round: string | null;
}

/** What the organiser tools show about confirmations; every status read in the components goes through it. */
export interface ConfirmationView {
  source: (name: string) => ConfirmationSource;
  toggle: (name: string) => ToggleMark;
  team: (team: TournamentTeam) => TeamConfirmation;
  summary: RosterConfirmationSummary;
}

/** Built once per render of a tools panel and passed down: the scored names are worked out here, not by each row. */
export function confirmationView(state: TournamentState): ConfirmationView {
  const scored = scoredPlayers(state);
  const marks = absenceMarks(state);
  const labels = bracketRoundLabels(state);
  return {
    source: (name) => confirmationSource(state, name, scored, marks),
    toggle: (name) => {
      const round = marks.absent.get(name) ?? marks.back.get(name);
      return {
        source: confirmationSource(state, name, scored, marks),
        round: round === undefined ? null : destinationLabel(round, labels),
      };
    },
    team: (team) => teamConfirmation(state, team, scored, marks),
    summary: rosterConfirmationSummary(state, scored, marks),
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

/** The hover text of a name's toggle: what it shows and what a click does. */
export function toggleTitle({ round, source }: ToggleMark): string {
  if (source === 'score') return 'Confirmed — has a score';
  if (source === 'back') return `Back from ${round} — click to undo`;
  if (source === 'manual') return 'Confirmed — click to undo';
  return round === null ? 'Not confirmed yet — click to confirm' : `Absent in ${round} — click when back`;
}
