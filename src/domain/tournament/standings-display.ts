import {
  applyGroupCutoffOrder,
  applyQualCutoffOrder,
  computeGroupStandings,
  computeQualificationStandings,
  getAllTies,
  isQualCutoffKey,
  isTieResolved,
  qualStandingsRoutes,
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
  /** With a waterfall Qual source: where each run of standings goes. `start` is the 0-based row the run begins at. */
  bands?: StandingsBand[];
}

export interface StandingsBand {
  start: number;
  /** The destination round's label, or "out" when the run is eliminated. */
  destination: string;
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

/** How a band of final standings is named wherever bands are shown: "→ R1C", or "out" for an eliminated run. */
export function standingsBandLabel(destination: string): string {
  return destination === 'out' ? 'out' : `→ ${destination}`;
}

/** The runs of consecutive standings that share a destination, in table order. */
function standingsBands(
  state: TournamentState,
  routes: NonNullable<ReturnType<typeof qualStandingsRoutes>>,
  rowCount: number,
): StandingsBand[] {
  const bands: StandingsBand[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const route = routes[index] ?? 'eliminated';
    const destination =
      route === 'eliminated'
        ? 'out'
        : (state.rounds[route]?.customLabel ?? `Round ${state.rounds[route]?.roundNum}`);
    if (bands.at(-1)?.destination !== destination) bands.push({ start: index, destination });
  }
  return bands;
}

function qualificationTable(state: TournamentState): StandingsDisplayTable {
  const computed = computeQualificationStandings(state, { liveRound: state.curRound });
  const ordered = applyQualCutoffOrder(computed, { ...state, qualTable: computed });
  const routes = qualStandingsRoutes(state);
  const cut = routes ? routes.length : state.cfg.qualAdv;
  // Every cut-off tie of the table counts as placing the units it picked (one key, or one per band boundary).
  const placedNames = Object.keys(state.tieResolutions)
    .filter(isQualCutoffKey)
    .flatMap((key) => tieResolutionList(state, key));
  return {
    key: 'qual-cutoff',
    label: state.rounds.some((round) => round.isSwiss) ? 'Swiss Standings' : 'Qualification Table',
    entries: rankStandings(ordered, new Set(placedNames)),
    cut: cut && cut < ordered.length ? cut : null,
    ...(routes ? { bands: standingsBands(state, routes, ordered.length) } : {}),
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

/** The counted rounds a table shows (indexes into state.rounds): every counted pooling round, or for a group the counted group-stage rounds in which that group plays a match. */
export function tableRoundIndexes(state: TournamentState, table: StandingsDisplayTable): number[] {
  return state.rounds.flatMap((round, index) => {
    if (!isCountedRound(round)) return [];
    const groupPlays = (round.matches ?? []).some((match) => match.group === table.groupLabel);
    return table.groupLabel === undefined || groupPlays ? [index] : [];
  });
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

/** The tie-resolution keys a table's cut-off ties live under: the qualification table has one per band boundary. */
function tieKeysOf(
  state: TournamentState,
  ties: Record<string, unknown>,
  table: StandingsDisplayTable,
): string[] {
  if (table.key !== 'qual-cutoff') return [table.key];
  return [...new Set([...Object.keys(ties), ...Object.keys(state.tieResolutions), table.key])].filter(
    isQualCutoffKey,
  );
}

/** Tie marks per table key, for the Standings tab. */
export function cutTieMarks(state: TournamentState, display: StandingsDisplay): Record<string, CutTieMarks> {
  const ties = getAllTies(state, state.curRound);
  return Object.fromEntries(
    display.tables.map((table) => {
      const keys = tieKeysOf(state, ties, table);
      const picked = keys.flatMap((key) => tieResolutionList(state, key));
      const pickedEntries = table.entries.filter((entry) => picked.includes(entry.name));
      const unresolved = keys.flatMap((key) => {
        const cluster = ties[key];
        return cluster && !isTieResolved(key, cluster, state) ? [cluster] : [];
      });
      const pending = unresolved.flatMap((cluster) => cluster.players.map((player) => player.name));
      // A cluster still waiting for a pick shows only "pending", never a partial placement.
      const placed = table.entries
        .filter(
          (entry) =>
            !pending.includes(entry.name) &&
            pickedEntries.some((pickedEntry) => sameStanding(pickedEntry, entry)),
        )
        .map((entry) => entry.name);
      return [table.key, { placed, pending }];
    }),
  );
}
