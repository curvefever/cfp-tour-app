import {
  tableRoundIndexes,
  type CutTieMarks,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { standingsGroupStarts } from '../tournament/components/result-row';
import { entriesSharingPercent } from '../tournament/components/standings-text';
import type { GroupSwapPicking } from './GroupSwap';

/** What one standings table is drawn from: the props of the wide table and of the phone list. */
export interface StandingsTableProps {
  className?: string;
  display: StandingsDisplay;
  followKey: string | null;
  marks: CutTieMarks | undefined;
  state: TournamentState;
  swap?: GroupSwapPicking | null;
  table: StandingsDisplayTable;
  unitLabel: string;
}

/** What both layouts read from a table the same way: its round columns, where a new group of rows begins, and which rows show the same whole percent. */
export function standingsTableParts(state: TournamentState, table: StandingsDisplayTable) {
  return {
    roundIndexes: tableRoundIndexes(state, table),
    groupStarts: standingsGroupStarts(table),
    sharesPercent: entriesSharingPercent(table.entries),
  };
}

/** Whether a unit's cut-off tie is placed by the organiser, or still pending. */
export function tieMarksOf(
  marks: CutTieMarks | undefined,
  name: string,
): { placed: boolean; pending: boolean } {
  return {
    placed: marks?.placed.includes(name) ?? false,
    pending: marks?.pending.includes(name) ?? false,
  };
}
