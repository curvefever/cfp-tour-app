/**
 * Likely absentees (`absenceVersion` 3, `tracksLikelyAbsentees`): the units the draws and the confirmation mark treat as
 * probably missing from the next round. A unit is one when it was **absent from the last round it was drawn into and
 * played**, and nobody has marked it back since. A unit that played counts as present, whatever it was before; a bye is
 * not a round played, so the unit's round before it counts. A team is absent when the absentee rules say so (every
 * member absent, or its one score absent) and is back as soon as any of its members is.
 *
 * Marking back is stored by player name (`state.backFromAbsence`: name -> the round index of the absence it answers),
 * so it follows a rename and a team's members, and a later absence (a later round index) never reads an old mark.
 */
import { absentInRoom, seatHasPlayed, tracksLikelyAbsentees } from './absences';
import { buildTeamMap } from './roster';
import type { TournamentState } from './types';

type TeamMap = ReturnType<typeof buildTeamMap>;

/** The player names behind a unit: a team's members, or the player itself. */
function playersOfUnit(teams: TeamMap, unit: string): string[] {
  const team = teams[unit];
  if (!team) return [unit];
  return team.members.flatMap((member) => (member ? [member.name] : []));
}

/** The units that took over an absent seat of the round at a swap: the absence is the swapped-out unit's, not theirs. */
function inheritedAbsences(state: TournamentState, roundIndex: number): Set<string> {
  return new Set(
    state.withdrawnUnits.flatMap((unit) =>
      unit.absentRound === roundIndex && unit.replacedBy !== undefined ? [unit.replacedBy] : [],
    ),
  );
}

/** Where a unit sits in a round, if it has a room (a bye has none). */
function seatIn(
  state: TournamentState,
  roundIndex: number,
  unit: string,
): { room: number; position: number } | null {
  const seated: Record<number, number> = {};
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room === null) continue;
    const position = (seated[entry.room] = (seated[entry.room] ?? -1) + 1);
    if (entry.name === unit) return { room: entry.room, position };
  }
  return null;
}

/**
 * The round index of the unit's latest absence that nothing has followed: scanning back from the round before
 * `beforeRound`, the first round that holds the unit in a room and either has it absent (that round) or has it play (null).
 * A round it is seated in but has no score in yet is skipped, as is a bye. Null when no such round exists.
 */
export function latestAbsenceRound(
  state: TournamentState,
  unit: string,
  beforeRound: number = state.rounds.length,
): number | null {
  for (let roundIndex = Math.min(beforeRound, state.rounds.length) - 1; roundIndex >= 0; roundIndex -= 1) {
    const seat = seatIn(state, roundIndex, unit);
    if (!seat) continue;
    if (inheritedAbsences(state, roundIndex).has(unit)) continue;
    if (absentInRoom(state, roundIndex, seat.room).includes(unit)) return roundIndex;
    if (seatHasPlayed(state, roundIndex, seat.room, seat.position)) return null;
  }
  return null;
}

/** Whether one of the unit's players was marked back from the absence of round `absenceRound`. */
function isBackFrom(state: TournamentState, unit: string, absenceRound: number): boolean {
  return playersOfUnit(buildTeamMap(state), unit).some(
    (name) => state.backFromAbsence?.[name] === absenceRound,
  );
}

/**
 * Whether the unit is likely to be absent from the round `beforeRound` (default: any round that follows the rounds so
 * far): its latest absence is not answered by a back mark. Always false before `absenceVersion` 3.
 */
export function isLikelyAbsent(
  state: TournamentState,
  unit: string,
  beforeRound: number = state.rounds.length,
): boolean {
  if (!tracksLikelyAbsentees(state)) return false;
  const absenceRound = latestAbsenceRound(state, unit, beforeRound);
  return absenceRound !== null && !isBackFrom(state, unit, absenceRound);
}

/** The units of the rounds before `targetRoundIndex` that are likely absent from it. */
export function likelyAbsentees(state: TournamentState, targetRoundIndex: number): Set<string> {
  const likely = new Set<string>();
  if (!tracksLikelyAbsentees(state)) return likely;
  const seen = new Set<string>();
  for (let roundIndex = 0; roundIndex < targetRoundIndex; roundIndex += 1) {
    for (const entry of state.assignments[roundIndex] ?? []) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      if (isLikelyAbsent(state, entry.name, targetRoundIndex)) likely.add(entry.name);
    }
  }
  return likely;
}

/** The units a player stands for: the teams that have it as a member, or the player itself. */
function unitsOfPlayer(state: TournamentState, name: string): string[] {
  const teams = Object.entries(buildTeamMap(state)).filter(([, team]) =>
    team.members.some((member) => member?.name === name),
  );
  return teams.length ? teams.map(([unit]) => unit) : [name];
}

/**
 * Marks a player back from the absence of its unit's latest round (a team is back once any member is). The same state
 * comes back when the unit is not likely absent, so there is nothing to answer.
 */
export function markBack(state: TournamentState, playerName: string): TournamentState {
  if (!tracksLikelyAbsentees(state)) return state;
  for (const unit of unitsOfPlayer(state, playerName)) {
    const absenceRound = latestAbsenceRound(state, unit);
    if (absenceRound === null || isBackFrom(state, unit, absenceRound)) continue;
    return { ...state, backFromAbsence: { ...state.backFromAbsence, [playerName]: absenceRound } };
  }
  return state;
}

/** Takes a player's back mark away (the organiser's undo); the same state comes back when it has none. */
export function unmarkBack(state: TournamentState, playerName: string): TournamentState {
  if (state.backFromAbsence?.[playerName] === undefined) return state;
  const { [playerName]: _removed, ...rest } = state.backFromAbsence;
  return { ...state, backFromAbsence: rest };
}

/** A rename keeps the person, so their back mark follows the new spelling. */
export function moveBackMark(state: TournamentState, oldName: string, newName: string): TournamentState {
  const round = state.backFromAbsence?.[oldName];
  if (round === undefined) return state;
  const { [oldName]: _removed, ...rest } = state.backFromAbsence;
  return { ...state, backFromAbsence: { ...rest, [newName]: round } };
}

export interface AbsenceMarks {
  /** Players likely absent since the round (the index): their toggle reads "?" and nothing confirms them. */
  absent: Map<string, number>;
  /** Players marked back from the absence of the round (the index): their toggle reads ✓. */
  back: Map<string, number>;
}

/**
 * The confirmation marks the absences give every player, worked out once for a panel: a unit's players are absent
 * while the unit is likely absent, and the ones marked back from its latest absence are back (the others of a team
 * with a member back are neither). Empty before `absenceVersion` 3.
 */
export function absenceMarks(state: TournamentState): AbsenceMarks {
  const marks: AbsenceMarks = { absent: new Map(), back: new Map() };
  if (!tracksLikelyAbsentees(state)) return marks;
  const teams = buildTeamMap(state);
  const seen = new Set<string>();
  for (const round of state.assignments) {
    for (const { name } of round) {
      if (seen.has(name)) continue;
      seen.add(name);
      const absenceRound = latestAbsenceRound(state, name);
      if (absenceRound === null) continue;
      const players = playersOfUnit(teams, name);
      const back = players.filter((player) => state.backFromAbsence?.[player] === absenceRound);
      for (const player of back) marks.back.set(player, absenceRound);
      if (back.length === 0) for (const player of players) marks.absent.set(player, absenceRound);
    }
  }
  return marks;
}
