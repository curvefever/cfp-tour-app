import {
  applyGroupCutoffOrder,
  applyQualCutoffOrder,
  computeGroupStandings,
  computeQualificationStandings,
  getAllTies,
  isTieResolved,
  refreshRoundStandings,
  isRoomFullyScored,
  isUncontestedRoom,
  rankStandings,
  sameStanding,
} from './advancement';
import { tieResolutionList } from './scoring';
import type { TournamentRound, TournamentStanding, TournamentState } from './types';

/**
 * The single source for every standings display (Standings tab, Bracket
 * column, follow banner, Rankings badge). Unlike the advancement
 * calculation, it counts a current-round room only once it is fully scored.
 */

export interface StandingsDisplayTable {
  /** The tie-resolution key of this table's cut-off tie. */
  key: 'qual-cutoff' | `group-cutoff-${string}`;
  label: string;
  groupLabel?: string;
  /** Cut-off order applied, ranked. */
  entries: Array<TournamentStanding & { rank: number | null }>;
  /** Units that go through; null when everyone does. */
  cut: number | null;
}

export interface StandingsDisplay {
  phase: 'upcoming' | 'live' | 'final';
  /** Counted rounds complete. */
  roundsDone: number;
  /** Counted rounds in the schedule. */
  roundsTotal: number;
  firstCountedRoundNum: number;
  /** The Bracket column goes right after this round. */
  lastStandingsRoundIndex: number;
  perGroup: boolean;
  tables: StandingsDisplayTable[];
}

function isStandingsRound(round: TournamentRound): boolean {
  return Boolean(round.isQual || round.isSwiss || round.isGroupStage);
}

function isCountedRound(round: TournamentRound): boolean {
  return isStandingsRound(round) && !round.excludeFromStandings;
}

export function hasStandingsPhase(state: TournamentState): boolean {
  return state.rounds.some(isStandingsRound);
}

/** A round is complete once it has contested rooms and every one is fully scored. */
function isRoundFullyScored(state: TournamentState, roundIndex: number): boolean {
  const rooms = (state.rounds[roundIndex]?.rooms ?? []).map((_, index) => index + 1);
  const contested = rooms.filter((room) => !isUncontestedRoom(state, roundIndex, room));
  const occupied = contested.filter((room) =>
    (state.assignments[roundIndex] ?? []).some((entry) => entry.room === room),
  );
  return occupied.length > 0 && occupied.every((room) => isRoomFullyScored(state, roundIndex, room));
}

function countRoundsDone(state: TournamentState, countedIndexes: number[]): number {
  return countedIndexes.filter(
    (index) => index < state.curRound || (index === state.curRound && isRoundFullyScored(state, index)),
  ).length;
}

function qualificationTable(state: TournamentState): StandingsDisplayTable {
  const computed = computeQualificationStandings(state, { liveRound: state.curRound });
  const ordered = applyQualCutoffOrder(computed, { ...state, qualTable: computed });
  const cut = state.cfg.qualAdv;
  return {
    key: 'qual-cutoff',
    label: state.rounds.some((round) => round.isSwiss) ? 'Swiss Standings' : 'Qualification Table',
    entries: rankStandings(ordered, new Set(tieResolutionList(state, 'qual-cutoff'))),
    cut: cut && cut < ordered.length ? cut : null,
  };
}

function groupTables(state: TournamentState): StandingsDisplayTable[] {
  const computed = computeGroupStandings(state, { liveRound: state.curRound });
  const cut = state.cfg.qualifiersPerGroup;
  return state.groups.map((group) => {
    const ordered = applyGroupCutoffOrder(group.label, computed[group.label] ?? [], {
      ...state,
      groupStandings: computed,
    });
    const key = `group-cutoff-${group.label}` as const;
    return {
      key,
      label: `Group ${group.label}`,
      groupLabel: group.label,
      entries: rankStandings(ordered, new Set(tieResolutionList(state, key))),
      cut: cut && cut < ordered.length ? cut : null,
    };
  });
}

export function describeStandings(state: TournamentState): StandingsDisplay | null {
  if (!hasStandingsPhase(state)) return null;
  const standingsIndexes = state.rounds.flatMap((round, index) => (isStandingsRound(round) ? [index] : []));
  const countedIndexes = state.rounds.flatMap((round, index) => (isCountedRound(round) ? [index] : []));
  const lastStandingsRoundIndex = standingsIndexes[standingsIndexes.length - 1];
  const perGroup = state.rounds.some((round) => round.isGroupStage);
  const tables = perGroup ? groupTables(state) : [qualificationTable(state)];
  const nothingPlayed = tables.every((table) => table.entries.every((entry) => entry.totalFP === null));
  const phase = state.curRound > lastStandingsRoundIndex ? 'final' : nothingPlayed ? 'upcoming' : 'live';
  return {
    phase,
    roundsDone: countRoundsDone(state, countedIndexes),
    roundsTotal: countedIndexes.length,
    firstCountedRoundNum: state.rounds[countedIndexes[0] ?? standingsIndexes[0]].roundNum,
    lastStandingsRoundIndex,
    perGroup,
    tables,
  };
}

/** Where a unit stands: null when it isn't in any table or has no rank yet. `insideCut` is null when everyone goes through. */
export function standingFor(
  display: StandingsDisplay,
  name: string,
): { rank: number; groupLabel?: string; insideCut: boolean | null } | null {
  for (const table of display.tables) {
    const index = table.entries.findIndex((entry) => entry.name === name);
    if (index === -1) continue;
    const { rank } = table.entries[index];
    if (rank === null) return null;
    return {
      rank,
      groupLabel: table.groupLabel,
      insideCut: table.cut === null ? null : index < table.cut,
    };
  }
  return null;
}

export interface CutTieMarks {
  /** Units placed by a resolved cut-off tie: everything level with a picked unit, in any phase. */
  placed: string[];
  /** Members of a cut-off tie cluster still waiting for the organiser's pick. */
  pending: string[];
}

/** Tie marks per table key, for the Standings tab. */
export function cutTieMarks(state: TournamentState, display: StandingsDisplay): Record<string, CutTieMarks> {
  const ties = getAllTies(refreshRoundStandings(state, state.curRound), state.curRound);
  return Object.fromEntries(
    display.tables.map((table) => {
      const picked = tieResolutionList(state, table.key);
      const pickedEntries = table.entries.filter((entry) => picked.includes(entry.name));
      const cluster = ties[table.key];
      const pending =
        cluster && !isTieResolved(table.key, cluster, state)
          ? cluster.players.map((player) => player.name)
          : [];
      // A cluster still waiting for a pick shows only "pending", never a partial placement.
      const placed = pending.length
        ? []
        : table.entries
            .filter((entry) => pickedEntries.some((pickedEntry) => sameStanding(pickedEntry, entry)))
            .map((entry) => entry.name);
      return [table.key, { placed, pending }];
    }),
  );
}
