import {
  compareStandings,
  isStandingsCutoffRound,
  relativeRoomShare,
  sameRoomShare,
  sameStanding,
} from './advancement';
import { describeStandings, type StandingsDisplay } from './standings-display';
import { computeGrandFinalRaceState } from './finals';
import { getFinalUnitScore, getUnitScore, tieResolutionList } from './scoring';
import { rosterKeys, unitDisplay } from './roster';
import type {
  RoundAssignment,
  TournamentRound,
  TournamentStanding,
  TournamentState,
  WithdrawnUnit,
} from './types';

export interface RankingDisplay {
  name: string;
  label: string;
  members: string[] | null;
}

interface ActiveRanking extends RankingDisplay {
  room: number | null;
  isLucky: boolean;
  poolRank: { rank: number; fp: number | null; groupLabel?: string } | null;
}

interface FinalistRanking extends RankingDisplay {
  total: number;
  rank: number;
}

interface EliminatedRanking extends RankingDisplay {
  ri: number;
  round: TournamentRound;
  room?: number;
  rank: number;
}

interface TournamentRankings {
  stillActive: ActiveRanking[];
  finalComplete: boolean;
  finalists: FinalistRanking[];
  eliminatedList: EliminatedRanking[];
  dnfList: WithdrawnUnit[];
  noShows: WithdrawnUnit[];
  lastRound: TournamentRound;
  lastRi: number;
}

export function lastAssignedRound(state: Pick<TournamentState, 'assignments'>): number {
  let last = -1;
  for (const [index, assignments] of state.assignments.entries()) {
    if (assignments?.length) last = index;
  }
  return last;
}

/** Where an eliminated unit stood in the table that decided its standings cut. */
interface CutPlacement {
  /** Position in its table (its group's table, for a Group Stage). */
  place: number;
  standing: TournamentStanding;
  /** The organiser picked this unit in a cut-off tie, so it never shares a rank. */
  resolved: boolean;
}

/** Each unit's placement in the standings tables, for ordering the units a standings cut eliminates. */
function cutPlacements(state: TournamentState, display: StandingsDisplay | null): Map<string, CutPlacement> {
  const placements = new Map<string, CutPlacement>();
  for (const table of display?.tables ?? []) {
    const resolved = tieResolutionList(state, table.key);
    for (const [place, standing] of table.entries.entries()) {
      placements.set(standing.name, { place, standing, resolved: resolved.includes(standing.name) });
    }
  }
  return placements;
}

/** What the round that eliminated a unit says about it: its place and relative share in its room, and the Kings Valley room. */
interface RoundElimination {
  ri: number;
  round: TournamentRound;
  /** Place in its room by score: 1 + the units with a strictly higher score, so level scores share a place. */
  place: number;
  /** Score relative to the room average (1 = average); an all-zero room gives everyone 1. */
  share: number;
  room?: number;
}

interface EliminatedEntry extends RoundElimination {
  name: string;
  /** Set when a standings cut eliminated the unit: its placement in the table that decided the cut. */
  cut?: CutPlacement;
  /** The unit's pooling placement, whatever eliminated it: the last tie-break between units level in the room. */
  standing?: CutPlacement;
}

function compareCutPlacement(first: CutPlacement, second: CutPlacement, perGroup: boolean): number {
  const byPlace = first.place - second.place;
  return perGroup && byPlace === 0 ? compareStandings(first.standing, second.standing) : byPlace;
}

function sameCutPlacement(first: CutPlacement, second: CutPlacement, perGroup: boolean): boolean {
  return (
    sameStanding(first.standing, second.standing) &&
    !(perGroup && first.place !== second.place) &&
    !first.resolved &&
    !second.resolved
  );
}

/** The earlier pooling placement, compared the way the cut compares it; a unit with a placement comes before one without, and neither having one is level. */
function compareStandingFallback(first: EliminatedEntry, second: EliminatedEntry, perGroup: boolean): number {
  if (first.standing && second.standing)
    return compareCutPlacement(first.standing, second.standing, perGroup);
  if (first.standing || second.standing) return first.standing ? -1 : 1;
  return 0;
}

function sameStandingFallback(first: EliminatedEntry, second: EliminatedEntry, perGroup: boolean): boolean {
  if (first.standing && second.standing) return sameCutPlacement(first.standing, second.standing, perGroup);
  return !first.standing && !second.standing;
}

/** Two units eliminated in the same round, neither at a standings cut: lower Kings Valley room, lower place in the room, higher room share, then the pooling standings. */
function compareWithinRound(first: EliminatedEntry, second: EliminatedEntry, perGroup: boolean): number {
  if (first.room !== undefined && second.room !== undefined && first.room !== second.room) {
    return first.room - second.room; // lower room number (closer to the top) ranks higher
  }
  if (first.place !== second.place) return first.place - second.place;
  if (!sameRoomShare(first.share, second.share)) return second.share - first.share;
  return compareStandingFallback(first, second, perGroup);
}

/** Later elimination first; at a standings cut by place in the table (a Group Stage: by place in the group, then by standing); else see compareWithinRound. */
function compareEliminated(perGroup: boolean) {
  return (first: EliminatedEntry, second: EliminatedEntry): number => {
    if (second.ri !== first.ri) return second.ri - first.ri;
    if (first.cut && second.cut) return compareCutPlacement(first.cut, second.cut, perGroup);
    if (first.cut || second.cut) return first.cut ? -1 : 1;
    return compareWithinRound(first, second, perGroup);
  };
}

/** Neighbours in the eliminated order share a rank when nothing separates them: the same standing at a cut, else the same Kings Valley room, place, room share and pooling standing. */
function sharesRank(previous: EliminatedEntry, current: EliminatedEntry, perGroup: boolean): boolean {
  if (previous.ri !== current.ri) return false;
  if (previous.cut && current.cut) return sameCutPlacement(previous.cut, current.cut, perGroup);
  if (previous.cut || current.cut) return false;
  return (
    previous.room === current.room &&
    previous.place === current.place &&
    sameRoomShare(previous.share, current.share) &&
    sameStandingFallback(previous, current, perGroup)
  );
}

function assignmentsByRoom(assignments: RoundAssignment[]) {
  const rooms = new Map<string, RoundAssignment[]>();
  for (const assignment of assignments) {
    const key = String(assignment.room);
    rooms.set(key, [...(rooms.get(key) ?? []), assignment]);
  }
  return rooms;
}

/**
 * Names of the units a round sent on. A bracket or waterfall round's own routing can send occupants to
 * several rounds (exactly [winnersTo, losersTo] for a double-elimination round, every distinct
 * non-'eliminated' index in waterfallRoutes for a waterfall round, which can be more than 2), so its
 * survivors are the union over those rounds; any other round sends its units to the next one.
 */
function survivorNames(state: TournamentState, roundIndex: number, round: TournamentRound): Set<string> {
  if (!round.bracket && !round.isWaterfall) {
    return new Set((state.assignments[roundIndex + 1] ?? []).map(({ name }) => name));
  }
  const destinations = round.bracket
    ? [round.winnersTo, round.losersTo].filter(
        (index): index is number => index !== null && index !== undefined,
      )
    : [
        ...new Set(
          (round.waterfallRoutes ?? []).flatMap((roomRoutes) =>
            roomRoutes.filter((destination): destination is number => destination !== 'eliminated'),
          ),
        ),
      ];
  return new Set(destinations.flatMap((index) => (state.assignments[index] ?? []).map(({ name }) => name)));
}

/** The units one round eliminated, each with its place and relative share in its room. */
function eliminationsInRound(state: TournamentState, roundIndex: number): Array<[string, RoundElimination]> {
  const round = state.rounds[roundIndex];
  const survived = survivorNames(state, roundIndex, round);
  const eliminations: Array<[string, RoundElimination]> = [];
  for (const [roomKey, roomAssignments] of assignmentsByRoom(state.assignments[roundIndex] ?? [])) {
    const room = Number(roomKey);
    const scored = roomAssignments.map((assignment, position) => ({
      name: assignment.name,
      score: getUnitScore(state, roundIndex, room, position, 0) ?? 0,
    }));
    for (const { name, score } of scored) {
      if (survived.has(name)) continue;
      eliminations.push([
        name,
        {
          ri: roundIndex,
          round,
          place: 1 + scored.filter((other) => other.score > score).length,
          share: relativeRoomShare(score, scored),
          room: round.isKingsValley ? room : undefined,
        },
      ]);
    }
  }
  return eliminations;
}

export function computeRankings(state: TournamentState): TournamentRankings | null {
  if (!state.rounds.length || !state.assignments.length) return null;
  const lastRi = lastAssignedRound(state);
  if (lastRi === -1) return null;

  const eliminated = new Map<string, RoundElimination>();
  for (let roundIndex = 0; roundIndex < lastRi; roundIndex += 1) {
    if (state.rounds[roundIndex].isFinal) continue;
    for (const [name, info] of eliminationsInRound(state, roundIndex)) eliminated.set(name, info);
  }

  const lastRound = state.rounds[lastRi];
  const lastAssignments = state.assignments[lastRi] ?? [];
  let active: RoundAssignment[] = [];
  let finalistValues: Array<{ name: string; total: number }> = [];
  let finalComplete = false;
  if (lastRound.isFinal && lastRound.bracket === 'grand-final') {
    const race = computeGrandFinalRaceState(state, lastRi, lastRound);
    finalComplete = Boolean(race?.decided);
    if (race?.decided) {
      const loser = race.winnerName === race.wbName ? race.lbName : race.wbName;
      finalistValues = [
        {
          name: race.winnerName as string,
          total: race.winnerName === race.wbName ? race.wbWins : race.lbWins,
        },
        {
          name: loser,
          total: race.winnerName === race.wbName ? race.lbWins : race.wbWins,
        },
      ];
    } else active = [...lastAssignments];
  } else if (lastRound.isFinal) {
    const games = lastRound.numGames ?? 0;
    finalComplete =
      lastAssignments.length > 0 &&
      lastAssignments.every((assignment) =>
        Array.from({ length: games }, (_, index) => index + 1).every(
          (game) => getFinalUnitScore(state, assignment.name, game, null) !== null,
        ),
      );
    if (finalComplete) {
      finalistValues = lastAssignments
        .map((assignment) => ({
          name: assignment.name,
          total: Array.from({ length: games }, (_, index) => index + 1).reduce(
            (sum, game) => sum + (getFinalUnitScore(state, assignment.name, game, 0) ?? 0),
            0,
          ),
        }))
        .sort((first, second) => second.total - first.total);
    } else active = [...lastAssignments];
  } else active = [...lastAssignments];

  // A removed/swapped-out unit's old name can still linger in a round that
  // was fully pre-generated before the withdrawal (e.g. group-stage's whole
  // schedule is built upfront) -- exclude anyone no longer on the roster so
  // they never appear as "still in tournament".
  const rosterSet = new Set(rosterKeys(state.players));
  active = active.filter((entry) => rosterSet.has(entry.name));

  const activeNames = new Set(active.map(({ name }) => name));
  const finalistNames = new Set(finalistValues.map(({ name }) => name));
  const standings = describeStandings(state);
  const placements = cutPlacements(state, standings);
  const perGroup = Boolean(standings?.perGroup);
  const eliminatedValues: EliminatedEntry[] = rosterKeys(state.players)
    .filter((name) => !activeNames.has(name) && !finalistNames.has(name))
    .flatMap((name) => {
      const info = eliminated.get(name);
      if (!info) return [];
      const standing = placements.get(name);
      return [
        { name, ...info, standing, cut: isStandingsCutoffRound(state, info.ri) ? standing : undefined },
      ];
    })
    .sort(compareEliminated(perGroup));

  // Eliminated units always rank below every unit that is not eliminated (still active, in the Final, finalists).
  const offset = rosterKeys(state.players).length - eliminatedValues.length;
  let rank = 0;
  const rankedEliminated = eliminatedValues.map((entry, index) => {
    const previous = eliminatedValues[index - 1];
    if (!previous || !sharesRank(previous, entry, perGroup)) rank = index + 1 + offset;
    return { name: entry.name, ri: entry.ri, round: entry.round, room: entry.room, rank };
  });

  let finalRank = 0;
  let previousTotal: number | null = null;
  const rankedFinalists = finalistValues.map((entry, index) => {
    if (lastRound.bracket === 'grand-final') return { ...entry, rank: index + 1 };
    if (entry.total !== previousTotal) {
      finalRank = index + 1;
      previousTotal = entry.total;
    }
    return { ...entry, rank: finalRank };
  });

  const poolRanks = new Map<string, { rank: number; fp: number | null; groupLabel?: string }>();
  for (const table of standings?.tables ?? []) {
    for (const entry of table.entries) {
      if (entry.rank !== null)
        poolRanks.set(entry.name, { rank: entry.rank, fp: entry.totalFP, groupLabel: table.groupLabel });
    }
  }

  const display = (name: string): RankingDisplay => ({
    name,
    ...unitDisplay(state, name),
  });
  const dnfList = state.withdrawnUnits.filter((unit) => unit.playedAnyMatch);
  const noShows = state.withdrawnUnits.filter((unit) => !unit.playedAnyMatch);
  return {
    stillActive: active
      .map((entry) => ({
        ...display(entry.name),
        room: entry.room,
        isLucky: Boolean(entry.isLucky),
        poolRank: poolRanks.get(entry.name) ?? null,
      }))
      .sort((first, second) => first.label.localeCompare(second.label)),
    finalComplete,
    finalists: rankedFinalists.map((entry) => ({
      ...entry,
      ...display(entry.name),
    })),
    eliminatedList: rankedEliminated.map((entry) => ({
      ...entry,
      ...display(entry.name),
    })),
    dnfList,
    noShows,
    lastRound,
    lastRi,
  };
}
