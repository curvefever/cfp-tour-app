import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { isLikelyAbsent, latestAbsenceRound } from '../../domain/tournament/likely-absentees';
import { tracksLikelyAbsentees } from '../../domain/tournament/absences';
import { unitDisplay } from '../../domain/tournament/roster';
import { currentColumn } from '../../domain/tournament/round-columns';
import type { TournamentState } from '../../domain/tournament/types';
import { toggleTitle } from '../rankings/confirmation-view';
import { destinationLabel } from './exit-text';

/** One name of the Bracket's likely-absent line. */
export interface LikelyAbsentChip {
  /** The roster unit: the player, or the team. */
  unit: string;
  /** What the chip reads: the player's name, or the team's. */
  label: string;
  /** The name the click marks back: the player, or a team's first member (a team is back once any member is). */
  clickName: string;
  /** The hover text, the same as the Players tab's toggle for this name. */
  title: string;
}

/** The column's seats in the order the Bracket reads: by room, then by seat, byes last. */
function seatedUnits(state: TournamentState, roundIndex: number): string[] {
  const entries = (state.assignments[roundIndex] ?? []).map((entry, index) => ({ ...entry, index }));
  const byRoom = (room: number | null) => room ?? Number.POSITIVE_INFINITY;
  return entries
    .sort((a, b) => byRoom(a.room) - byRoom(b.room) || a.index - b.index)
    .map((entry) => entry.name);
}

/**
 * The units of the column in play that are likely absent (`isLikelyAbsent`): each one a name for the organiser to mark
 * back. Before Next Round these are the units answered absent in the round in play; after the draw, the units of the
 * new round still expected missing (not scored there yet). Empty before `absenceVersion` 3.
 */
export function likelyAbsentChips(state: TournamentState): LikelyAbsentChip[] {
  if (!tracksLikelyAbsentees(state)) return [];
  const { start, end } = currentColumn(state);
  const labels = bracketRoundLabels(state);
  const withdrawn = new Set(state.withdrawnUnits.map((unit) => unit.name));
  const seen = new Set<string>();
  const chips: LikelyAbsentChip[] = [];
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    for (const unit of seatedUnits(state, roundIndex)) {
      if (seen.has(unit) || withdrawn.has(unit)) continue;
      seen.add(unit);
      const absenceRound = isLikelyAbsent(state, unit) ? latestAbsenceRound(state, unit) : null;
      if (absenceRound === null) continue;
      const { label, members } = unitDisplay(state, unit);
      const round = destinationLabel(absenceRound, labels);
      chips.push({
        unit,
        label,
        clickName: members?.[0] ?? unit,
        title: toggleTitle({ source: null, round }),
      });
    }
  }
  return chips;
}
