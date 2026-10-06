import { compareStandings, isStandingsCutoffRound, sameStanding } from './advancement';
import { describeStandings, type StandingsDisplay } from './standings-display';
import { computeGrandFinalRaceState } from './finals';
import { getFinalUnitScore, getUnitScore, orderRoomByScore, tieResolutionList } from './scoring';
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
  pct: number;
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

interface EliminatedEntry {
  name: string;
  ri: number;
  round: TournamentRound;
  pct: number;
  room?: number;
  cut?: CutPlacement;
}

/** Later elimination first; at a standings cut by place in the table (a Group Stage: by place in the group, then by standing); else a lower Kings Valley room, then room share. */
function compareEliminated(perGroup: boolean) {
  return (first: EliminatedEntry, second: EliminatedEntry): number => {
    if (second.ri !== first.ri) return second.ri - first.ri;
    if (first.cut && second.cut) {
      const byPlace = first.cut.place - second.cut.place;
      return perGroup && byPlace === 0 ? compareStandings(first.cut.standing, second.cut.standing) : byPlace;
    }
    if (first.cut || second.cut) return first.cut ? -1 : 1;
    if (first.room !== undefined && second.room !== undefined && first.room !== second.room) {
      return first.room - second.room; // lower room number (closer to the top) ranks higher
    }
    return second.pct - first.pct;
  };
}

/** Neighbours in the eliminated order share a rank when nothing separates them: the same standing at a cut, else the same Kings Valley room and room share. */
function sharesRank(previous: EliminatedEntry, current: EliminatedEntry, perGroup: boolean): boolean {
  if (previous.ri !== current.ri) return false;
  if (previous.cut && current.cut) {
    return (
      sameStanding(previous.cut.standing, current.cut.standing) &&
      !(perGroup && previous.cut.place !== current.cut.place) &&
      !previous.cut.resolved &&
      !current.cut.resolved
    );
  }
  if (previous.cut || current.cut) return false;
  return previous.room === current.room && previous.pct.toFixed(9) === current.pct.toFixed(9);
}

function assignmentsByRoom(assignments: RoundAssignment[]) {
  const rooms = new Map<string, RoundAssignment[]>();
  for (const assignment of assignments) {
    const key = String(assignment.room);
    rooms.set(key, [...(rooms.get(key) ?? []), assignment]);
  }
  return rooms;
}

export function computeRankings(state: TournamentState): TournamentRankings | null {
  if (!state.rounds.length || !state.assignments.length) return null;
  const lastRi = lastAssignedRound(state);
  if (lastRi === -1) return null;

  const eliminated = new Map<string, { ri: number; round: TournamentRound; pct: number; room?: number }>();
  for (let roundIndex = 0; roundIndex < lastRi; roundIndex += 1) {
    const round = state.rounds[roundIndex];
    if (round.isFinal) continue;
    const byRoom = assignmentsByRoom(state.assignments[roundIndex] ?? []);
    if (round.bracket || round.isWaterfall) {
      // A named 2-destination winners/losers split generalizes to a union
      // over however many distinct rounds this round's own routing can send
      // occupants to -- exactly [winnersTo, losersTo] for a double-elimination
      // round (identical to the previous behavior there), or every distinct
      // non-'eliminated' index in waterfallRoutes for a waterfall round,
      // which can be more than 2.
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
      const survived = new Set(
        destinations.flatMap((index) => (state.assignments[index] ?? []).map(({ name }) => name)),
      );
      for (const [roomKey, roomAssignments] of byRoom) {
        const room = Number(roomKey);
        const scored = orderRoomByScore(
          roomAssignments.map((assignment, position) => ({
            name: assignment.name,
            score: getUnitScore(state, roundIndex, room, position, 0) ?? 0,
          })),
          roundIndex,
          room,
          state,
        );
        const total = scored.reduce((sum, entry) => sum + entry.score, 0);
        for (const entry of scored) {
          if (!survived.has(entry.name)) {
            eliminated.set(entry.name, {
              ri: roundIndex,
              round,
              pct: total > 0 ? entry.score / total : 0,
            });
          }
        }
      }
    } else {
      const nextNames = new Set((state.assignments[roundIndex + 1] ?? []).map(({ name }) => name));
      for (const [roomKey, roomAssignments] of byRoom) {
        const room = Number(roomKey);
        const scored = roomAssignments.map((assignment, position) => ({
          name: assignment.name,
          score: getUnitScore(state, roundIndex, room, position, 0) ?? 0,
        }));
        const total = scored.reduce((sum, entry) => sum + entry.score, 0);
        for (const entry of scored) {
          if (!nextNames.has(entry.name)) {
            eliminated.set(entry.name, {
              ri: roundIndex,
              round,
              pct: total > 0 ? entry.score / total : 0,
              room: round.isKingsValley ? room : undefined,
            });
          }
        }
      }
    }
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
      return [
        { name, ...info, cut: isStandingsCutoffRound(state, info.ri) ? placements.get(name) : undefined },
      ];
    })
    .sort(compareEliminated(perGroup));

  // Eliminated units always rank below every unit that is not eliminated (still active, in the Final, finalists).
  const offset = rosterKeys(state.players).length - eliminatedValues.length;
  let rank = 0;
  const rankedEliminated = eliminatedValues.map(({ cut: _cut, ...entry }, index) => {
    const previous = eliminatedValues[index - 1];
    if (!previous || !sharesRank(previous, eliminatedValues[index], perGroup)) rank = index + 1 + offset;
    return { ...entry, rank };
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
