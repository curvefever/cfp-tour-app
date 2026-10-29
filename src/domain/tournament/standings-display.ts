import { absentInRoom } from './absences';
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
  /** Cut-off order applied, ranked. `absentRounds` (indexes into state.rounds) lists the counted rounds the unit was absent from its room: its cell reads "ABS". */
  entries: Array<TournamentStanding & { rank: number | null; absentRounds?: number[] }>;
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
  kind: StandingsKind;
  perGroup: boolean;
  tables: StandingsDisplayTable[];
}

/** The pooling phase that keeps standings: a qualification table, Swiss, or a group stage. */
export type StandingsKind = 'qualification' | 'swiss' | 'groups';

function isStandingsRound(round: TournamentRound): boolean {
  return Boolean(round.isQual || round.isSwiss || round.isGroupStage);
}

/** A round whose results add to the standings: a qualification, Swiss or group round that is not marked as seeding only. */
export function isCountedRound(round: TournamentRound): boolean {
  return isStandingsRound(round) && !round.excludeFromStandings;
}

/** Which kind of standings the schedule has; null without a standings phase (no pooling: warm-ups only). */
export function standingsKind(state: Pick<TournamentState, 'rounds'>): StandingsKind | null {
  if (state.rounds.some((round) => round.isGroupStage)) return 'groups';
  if (state.rounds.some((round) => round.isSwiss)) return 'swiss';
  if (state.rounds.some((round) => round.isQual)) return 'qualification';
  return null;
}

export function hasStandingsPhase(state: TournamentState): boolean {
  return standingsKind(state) !== null;
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

/** The counted rounds each unit was absent from its room in. */
function absentRoundsByUnit(state: TournamentState): Map<string, number[]> {
  const absent = new Map<string, number[]>();
  state.rounds.forEach((round, roundIndex) => {
    if (!isCountedRound(round)) return;
    for (let room = 1; room <= round.rooms.length; room += 1) {
      for (const name of absentInRoom(state, roundIndex, room)) {
        absent.set(name, [...(absent.get(name) ?? []), roundIndex]);
      }
    }
  });
  return absent;
}

/** The ranked entries with the rounds each unit was absent from marked, so a display can read "ABS". */
function withAbsentRounds(
  state: TournamentState,
  entries: StandingsDisplayTable['entries'],
): StandingsDisplayTable['entries'] {
  const absent = absentRoundsByUnit(state);
  if (absent.size === 0) return entries;
  return entries.map((entry) => {
    const absentRounds = absent.get(entry.name);
    return absentRounds ? { ...entry, absentRounds } : entry;
  });
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
    entries: withAbsentRounds(state, rankStandings(ordered, new Set(placedNames))),
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
      entries: withAbsentRounds(state, rankStandings(ordered, new Set(tieResolutionList(state, key)))),
      cut: cut && cut < ordered.length ? cut : null,
    };
  });
}

export function describeStandings(state: TournamentState): StandingsDisplay | null {
  const kind = standingsKind(state);
  if (kind === null) return null;
  const standingsIndexes = state.rounds.flatMap((round, index) => (isStandingsRound(round) ? [index] : []));
  const countedIndexes = state.rounds.flatMap((round, index) => (isCountedRound(round) ? [index] : []));
  const lastStandingsRoundIndex = standingsIndexes[standingsIndexes.length - 1];
  const perGroup = kind === 'groups';
  const tables = perGroup ? groupTables(state) : [qualificationTable(state)];
  const nothingPlayed = tables.every((table) => table.entries.every((entry) => entry.totalFP === null));
  const phase = state.curRound > lastStandingsRoundIndex ? 'final' : nothingPlayed ? 'upcoming' : 'live';
  return {
    phase,
    roundsDone: countRoundsDone(state, countedIndexes),
    roundsTotal: countedIndexes.length,
    firstCountedRoundNum: state.rounds[countedIndexes[0] ?? standingsIndexes[0]].roundNum,
    lastStandingsRoundIndex,
    kind,
    perGroup,
    tables,
  };
}

/** The run of a Qual source's table that row `index` (0-based) falls in. */
export function standingsBandAt(bands: StandingsBand[], index: number): StandingsBand {
  return [...bands].reverse().find((candidate) => candidate.start <= index) ?? bands[0];
}

/**
 * Whether row `index` (0-based) of a table is out: in an "out" run of a Qual source, else past the cut. The one test
 * behind the table's red rows (`standingsRowResult`) and Rankings' eliminations at a complete cut.
 */
export function isStandingsRowOut(
  table: Pick<StandingsDisplayTable, 'bands' | 'cut'>,
  index: number,
): boolean {
  if (table.bands && table.bands.length > 0) return standingsBandAt(table.bands, index).destination === 'out';
  return table.cut !== null && index >= table.cut;
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
