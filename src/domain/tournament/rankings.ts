import { absentInRoom } from './absences';
import {
  compareStandings,
  isRoomFullyScored,
  isStandingsCutoffRound,
  isUncontestedRoom,
  isWalkoverRoom,
  pendingTieNames,
  relativeRoomShare,
  sameRoomShare,
  sameStanding,
  scoreRoom,
} from './advancement';
import { describeStandings, isStandingsRowOut, type StandingsDisplay } from './standings-display';
import { exitBandAtRank, type RoomExitBand, roundExitRule } from './room-exits';
import { computeGrandFinalRaceState } from './finals';
import { lateJoinersOf } from './late-joiners';
import { isBestOfRound, roomMatch } from './match-format';
import { compareRankScores, getFinalUnitScore, orderRoomWithPlaces, tieResolutionList } from './scoring';
import { rosterKeys, unitDisplay } from './roster';
import type {
  RoundAssignment,
  TournamentRound,
  TournamentStanding,
  TournamentState,
  WithdrawnUnit,
} from './types';
import { isCurrentRound, roundColumn } from './round-columns';

export interface RankingDisplay {
  name: string;
  label: string;
  members: string[] | null;
}

export interface ActiveRanking extends RankingDisplay {
  room: number | null;
  isLucky: boolean;
  poolRank: { rank: number; fp: number | null; groupLabel?: string } | null;
  /** Index of the round this unit is routed to but not drawn into yet (it waits in that round's pending pool); `room` is null then. */
  waitingFor?: number;
  /** A unit added while a pooling round was in play: no room yet, drawn in by the round `waitingFor`. */
  joining?: true;
  /** The round the unit is drawn into: one of the rounds of the last drawn column (a column can hold several). Absent while it waits. */
  ri?: number;
}

export interface FinalistRanking extends RankingDisplay {
  total: number;
  rank: number;
}

export interface EliminatedRanking extends RankingDisplay {
  ri: number;
  round: TournamentRound;
  /** The Kings Valley room (the ranking orders by it); undefined in every other round. */
  room?: number;
  /** Null while the round that eliminated it is still in play: other rooms may still be playing. */
  rank: number | null;
  /** The room (1-based) it played the round that eliminated it in. */
  seat: number;
  /** Its place in that room by score; units with level scores share a place. */
  place: number;
  /** It was absent from the room that eliminated it: it ranks last of that round, below every present unit eliminated in it. */
  absent: boolean;
  /** A standings cut eliminated it (the last pooling round), so its standing says more than its room. */
  atCut: boolean;
  /** Its place in the pooling standings (in its group's table, for a Group Stage); null when it has none. */
  poolRank: { rank: number; groupLabel?: string } | null;
}

interface TournamentRankings {
  stillActive: ActiveRanking[];
  finalComplete: boolean;
  finalists: FinalistRanking[];
  eliminatedList: EliminatedRanking[];
  dnfList: WithdrawnUnit[];
  absentFromStart: WithdrawnUnit[];
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

/**
 * Whether the Final, the last drawn round, is complete: the race Grand Final decided, or every game of the plain
 * Final scored for every finalist (real keys only). False while the last drawn round is not a Final.
 */
export function isFinalComplete(state: TournamentState): boolean {
  const lastRi = lastAssignedRound(state);
  const round = state.rounds[lastRi];
  if (!round?.isFinal) return false;
  if (round.bracket === 'grand-final')
    return Boolean(computeGrandFinalRaceState(state, lastRi, round)?.decided);
  if (isBestOfRound(round)) return Boolean(roomMatch(state, lastRi, 1)?.complete);
  const games = Array.from({ length: round.numGames ?? 0 }, (_, index) => index + 1);
  const assignments = state.assignments[lastRi] ?? [];
  return (
    assignments.length > 0 &&
    assignments.every((assignment) =>
      games.every((game) => getFinalUnitScore(state, assignment.name, game, null) !== null),
    )
  );
}

/** The finalists of a decided Best-of Final, best first: the value shown is the wins, the total score ranks equal wins. */
function bestOfFinalists(
  state: TournamentState,
  roundIndex: number,
): Array<{ name: string; total: number; tiebreak: number }> {
  return (roomMatch(state, roundIndex, 1)?.units ?? [])
    .map((unit) => ({ name: unit.name, total: unit.wins, tiebreak: unit.total }))
    .sort((first, second) =>
      compareRankScores(
        { score: first.total, tiebreak: first.tiebreak },
        { score: second.total, tiebreak: second.tiebreak },
      ),
    );
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
  /** The room it played in, 1-based, whatever the round. */
  seat: number;
  /** It was absent from that room: it ranks below every present unit eliminated in the same round (the Kings Valley room first). */
  absent?: true;
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

/** Two units eliminated in the same round, neither at a standings cut: lower Kings Valley room, a present unit before an absentee, lower place in the room, higher room share, then the pooling standings. Absentees of a round have no place or share to compare: they follow the pooling standings. */
function compareWithinRound(first: EliminatedEntry, second: EliminatedEntry, perGroup: boolean): number {
  if (first.room !== undefined && second.room !== undefined && first.room !== second.room) {
    return first.room - second.room; // lower room number (closer to the top) ranks higher
  }
  if (Boolean(first.absent) !== Boolean(second.absent)) return first.absent ? 1 : -1;
  if (first.absent) return compareStandingFallback(first, second, perGroup);
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
    Boolean(previous.absent) === Boolean(current.absent) &&
    (previous.absent || (previous.place === current.place && sameRoomShare(previous.share, current.share))) &&
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
 * non-'eliminated' index in waterfallRoutes for a waterfall round, which can be more than 2; a
 * qualification round feeding a waterfall graph routes its standings the same way through
 * standingsRoutes), so its survivors are the union over those rounds; any other round sends its units to
 * the next one. A unit waiting in a destination's pendingBracketSeeds (not drawn into it yet) is still a
 * survivor.
 */
function survivorNames(state: TournamentState, roundIndex: number, round: TournamentRound): Set<string> {
  if (!round.bracket && !round.isWaterfall && !round.standingsRoutes) {
    return new Set((state.assignments[roundIndex + 1] ?? []).map(({ name }) => name));
  }
  const destinations = round.bracket
    ? [round.winnersTo, round.losersTo].filter(
        (index): index is number => index !== null && index !== undefined,
      )
    : [
        ...new Set(
          [...(round.waterfallRoutes ?? []).flat(), ...(round.standingsRoutes ?? [])].filter(
            (destination): destination is number => destination !== 'eliminated',
          ),
        ),
      ];
  return new Set(
    destinations.flatMap((index) => [
      ...(state.assignments[index] ?? []).map(({ name }) => name),
      ...(state.pendingBracketSeeds[index] ?? []).map(({ name }) => name),
    ]),
  );
}

/** The units of a round that `isOut` names, each with its place and relative share in its room. */
function eliminationsInRound(
  state: TournamentState,
  roundIndex: number,
  isOut: (name: string) => boolean,
): Array<[string, RoundElimination]> {
  const round = state.rounds[roundIndex];
  const eliminations: Array<[string, RoundElimination]> = [];
  for (const [roomKey, roomAssignments] of assignmentsByRoom(state.assignments[roundIndex] ?? [])) {
    const room = Number(roomKey);
    // The units that were present, then the absentees, who rank below every present unit of the round.
    const scored = Number.isInteger(room)
      ? scoreRoom(state, roundIndex, room, 0)
      : roomAssignments.map(({ name }) => ({ name, score: 0, players: 1 }));
    const absent = Number.isInteger(room) ? absentInRoom(state, roundIndex, room) : [];
    const entry = { ri: roundIndex, round, room: round.isKingsValley ? room : undefined, seat: room };
    for (const unit of scored) {
      const { name, score, players } = unit;
      if (!isOut(name)) continue;
      eliminations.push([
        name,
        {
          ...entry,
          place: 1 + scored.filter((other) => compareRankScores(other, unit) < 0).length,
          share: relativeRoomShare(score, scored, players),
        },
      ]);
    }
    for (const name of absent.filter(isOut)) {
      eliminations.push([name, { ...entry, place: scored.length + 1, share: 0, absent: true }]);
    }
  }
  return eliminations;
}

/** The units an advanced round eliminated: every unit it did not send on. */
function eliminatedByPastRound(
  state: TournamentState,
  roundIndex: number,
): Array<[string, RoundElimination]> {
  const survived = survivorNames(state, roundIndex, state.rounds[roundIndex]);
  return eliminationsInRound(state, roundIndex, (name) => !survived.has(name));
}

/** The rows a complete room of a per-room round draws red (`roomRowResult`): no band, or an eliminate band. */
function outOfCompleteRooms(
  state: TournamentState,
  roundIndex: number,
  rooms: RoomExitBand[][],
): Set<string> {
  const pending = pendingTieNames(state, roundIndex);
  const out = new Set<string>();
  for (const [roomKey] of assignmentsByRoom(state.assignments[roundIndex] ?? [])) {
    const room = Number(roomKey);
    if (!Number.isInteger(room) || isUncontestedRoom(state, roundIndex, room)) continue;
    if (!isRoomFullyScored(state, roundIndex, room)) continue;
    const scored = scoreRoom(state, roundIndex, room, null);
    // A room with one present unit is a walkover: nobody there is placed.
    const placed = isWalkoverRoom(state, roundIndex, room)
      ? []
      : orderRoomWithPlaces(scored, roundIndex, room, state);
    for (const { entry, place } of placed) {
      const band = exitBandAtRank(rooms[room - 1] ?? [], place);
      if (!pending.has(entry.name) && (!band || band.kind === 'eliminate')) out.add(entry.name);
    }
    const round = state.rounds[roundIndex];
    // An absentee of a winners round drops to the losers bracket: still in play.
    if (round.bracket === 'winners') continue;
    for (const [index, name] of absentInRoom(state, roundIndex, room).entries()) {
      // An absentee is ranked last of its room: a custom bracket or Kings Valley routes it by that rank, every other round cuts it.
      const band = exitBandAtRank(rooms[room - 1] ?? [], scored.length + index + 1);
      if (!(round.isWaterfall || round.isKingsValley) || !band || band.kind === 'eliminate') out.add(name);
    }
  }
  return out;
}

/** The rows the standings tables draw red once every room of the cut-off round is scored (`isStandingsRowOut`). */
function outAtCompleteCut(state: TournamentState, roundIndex: number): Set<string> {
  const rooms = new Set(
    (state.assignments[roundIndex] ?? []).flatMap(({ room }) => (room === null ? [] : [room])),
  );
  const complete = [...rooms].every(
    (room) => isWalkoverRoom(state, roundIndex, room) || isRoomFullyScored(state, roundIndex, room),
  );
  if (!complete) return new Set();
  const pending = pendingTieNames(state, roundIndex);
  const out = new Set<string>();
  for (const table of describeStandings(state)?.tables ?? []) {
    table.entries.forEach((entry, index) => {
      if (entry.rank !== null && isStandingsRowOut(table, index) && !pending.has(entry.name))
        out.add(entry.name);
    });
  }
  return out;
}

/**
 * The units of a round still in play that are already certainly out: exactly the rows the Bracket draws red in a
 * complete room, or the rows the standings tables draw red at a complete cut. Never a unit in a tie the organiser has
 * not resolved, nor a lucky-loser candidate; nobody in a round whose standings or Final decide later.
 */
function outInPlay(state: TournamentState, roundIndex: number): Set<string> {
  const rule = roundExitRule(state, roundIndex);
  if (rule.kind === 'per-room') return outOfCompleteRooms(state, roundIndex, rule.rooms);
  if (rule.kind === 'standings-cutoff') return outAtCompleteCut(state, roundIndex);
  return new Set();
}

/**
 * Units routed to a round that is not drawn yet: they wait in that round's pending pool (a waterfall band
 * sent several rounds ahead, a double-elimination loser waiting for a deferred losers round). They are
 * still in the tournament, so they are listed with the round they wait for, once.
 */
function waitingUnits(
  state: TournamentState,
  lastDrawnIndex: number,
  roster: ReadonlySet<string>,
  active: RoundAssignment[],
): Array<{ name: string; isLucky: boolean; waitingFor: number }> {
  const seen = new Set(active.map(({ name }) => name));
  const waiting: Array<{ name: string; isLucky: boolean; waitingFor: number }> = [];
  for (const [key, seeds] of Object.entries(state.pendingBracketSeeds)) {
    const waitingFor = Number(key);
    if (waitingFor <= lastDrawnIndex) continue;
    for (const seed of seeds) {
      if (!roster.has(seed.name) || seen.has(seed.name)) continue;
      seen.add(seed.name);
      waiting.push({ name: seed.name, isLucky: Boolean(seed.isLucky), waitingFor });
    }
  }
  return waiting;
}

/**
 * Units added to the roster while a pooling round is in play: the round stays as drawn, so they sit it
 * out and are drawn in by the next round. Still in the tournament, listed as waiting for that round.
 */
function undrawnJoiners(
  state: TournamentState,
  pooled: ReadonlySet<string>,
): Array<{ name: string; isLucky: boolean; waitingFor: number; joining?: true }> {
  return lateJoinersOf(state, state.curRound)
    .filter((name) => !pooled.has(name))
    .map((name) => ({ name, isLucky: false, waitingFor: state.curRound + 1, joining: true as const }));
}

export function computeRankings(state: TournamentState): TournamentRankings | null {
  if (!state.rounds.length || !state.assignments.length) return null;
  const lastRi = lastAssignedRound(state);
  if (lastRi === -1) return null;

  // The last drawn column is still in play, every round of it: a unit in any of them is eliminated only once it is
  // certainly out (outInPlay), and has no rank number until its round is advanced.
  const lastColumn = roundColumn(state.rounds, lastRi);
  const eliminated = new Map<string, RoundElimination>();
  for (let roundIndex = 0; roundIndex < lastColumn.start; roundIndex += 1) {
    if (state.rounds[roundIndex].isFinal) continue;
    for (const [name, info] of eliminatedByPastRound(state, roundIndex)) eliminated.set(name, info);
  }
  const outNow = new Set<string>();
  for (let roundIndex = lastColumn.start; roundIndex <= lastColumn.end; roundIndex += 1) {
    if (state.rounds[roundIndex].isFinal) continue;
    const out = outInPlay(state, roundIndex);
    for (const [name, info] of eliminationsInRound(state, roundIndex, (name) => out.has(name))) {
      eliminated.set(name, info);
      outNow.add(name);
    }
  }

  const lastRound = state.rounds[lastRi];
  const lastAssignments = state.assignments[lastRi] ?? [];
  let active: Array<RoundAssignment & { ri?: number }> = [];
  let finalistValues: Array<{ name: string; total: number; tiebreak?: number }> = [];
  const finalComplete = isFinalComplete(state);
  if (lastRound.isFinal && lastRound.bracket === 'grand-final') {
    const race = computeGrandFinalRaceState(state, lastRi, lastRound);
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
    if (finalComplete && isBestOfRound(lastRound)) {
      finalistValues = bestOfFinalists(state, lastRi);
    } else if (finalComplete) {
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
  } else {
    active = state.assignments
      .slice(lastColumn.start, lastColumn.end + 1)
      .flatMap((assignments, offset) =>
        (assignments ?? []).map((entry) => ({ ...entry, ri: lastColumn.start + offset })),
      );
  }

  // A removed/swapped-out unit's old name can still linger in a round that
  // was fully pre-generated before the withdrawal (e.g. group-stage's whole
  // schedule is built upfront) -- exclude anyone no longer on the roster so
  // they never appear as "still in tournament".
  const rosterSet = new Set(rosterKeys(state.players));
  active = active.filter((entry) => rosterSet.has(entry.name) && !outNow.has(entry.name));
  const pooled = finalComplete ? [] : waitingUnits(state, lastRi, rosterSet, active);
  const waiting = [
    ...pooled,
    ...(isCurrentRound(state, lastRi) && !finalComplete
      ? undrawnJoiners(state, new Set(pooled.map(({ name }) => name)))
      : []),
  ];

  const activeNames = new Set([...active.map(({ name }) => name), ...waiting.map(({ name }) => name)]);
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
    return {
      name: entry.name,
      ri: entry.ri,
      round: entry.round,
      room: entry.room,
      rank: entry.ri >= lastColumn.start ? null : rank,
      seat: entry.seat,
      place: entry.place,
      absent: Boolean(entry.absent),
      atCut: Boolean(entry.cut),
    };
  });

  let finalRank = 0;
  let previousTotal: number | null = null;
  let previousTiebreak: number | undefined;
  const rankedFinalists = finalistValues.map((entry, index) => {
    if (lastRound.bracket === 'grand-final') return { ...entry, rank: index + 1 };
    if (entry.total !== previousTotal || entry.tiebreak !== previousTiebreak) {
      finalRank = index + 1;
      previousTotal = entry.total;
      previousTiebreak = entry.tiebreak;
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
  const absentFromStart = state.withdrawnUnits.filter((unit) => !unit.playedAnyMatch);
  return {
    stillActive: [
      ...active.map((entry) => ({
        name: entry.name,
        room: entry.room,
        isLucky: Boolean(entry.isLucky),
        ri: 'ri' in entry ? (entry.ri as number) : lastRi,
      })),
      ...waiting.map((entry) => ({ ...entry, room: null })),
    ]
      .map(({ name, ...rest }) => ({
        ...display(name),
        ...rest,
        poolRank: poolRanks.get(name) ?? null,
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
      poolRank: poolRanks.get(entry.name) ?? null,
    })),
    dnfList,
    absentFromStart,
    lastRound,
    lastRi,
  };
}

/** A tournament's winner, as the Tournaments list shows it: the name, with a team's members. */
export interface TournamentWinner {
  label: string;
  members: string[] | null;
}

/** The units ranked first once the Final is complete (a tie for first gives several); nobody before that. */
export function tournamentWinners(state: TournamentState): TournamentWinner[] {
  const rankings = computeRankings(state);
  if (!rankings?.finalComplete) return [];
  return rankings.finalists
    .filter((unit) => unit.rank === 1)
    .map((unit) => ({ label: unit.label, members: unit.members }));
}
