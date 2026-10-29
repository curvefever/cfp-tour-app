import {
  absentSeats,
  isMemberMarkedAbsent,
  seatAbsenceKeys,
  survivalMemberKey,
} from '../../domain/tournament/absences';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { buildTeamMap, unitDisplay } from '../../domain/tournament/roster';
import { currentColumn } from '../../domain/tournament/round-columns';
import { occupiedRooms } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { roundAndRoom } from './ranking-where';

/** A unit that was absent from one room of a round, as the ABSENT panel lists it. */
export interface AbsentMatchRow {
  id: string;
  /** The unit's key: a player's name or a team id. */
  unit: string;
  label: string;
  /** "Round 2 · Room B", the round named as the Bracket names it. */
  where: string;
  roundIndex: number;
  room: number;
  /** The score keys marked absent, which "Mark as played" answers again. */
  keys: string[];
  /** The round is in play: a past round is read-only, and Previous is the way back. */
  canMarkPlayed: boolean;
  /** The unit's most recent absence: the row that carries the unit's own tools (swap, remove) and the streak. */
  latest: boolean;
  /** How many rounds in a row the unit has been absent, ending with this one; shown from 2. */
  streak: number;
}

/** "absent 2 rounds running" when it applies, else an empty string. */
export function streakText(streak: number): string {
  return streak >= 2 ? `absent ${streak} rounds running` : '';
}

/** How many rounds in a row, ending at `last`, the unit was absent. */
function runEndingAt(rounds: ReadonlySet<number>, last: number): number {
  let run = 0;
  while (rounds.has(last - run)) run += 1;
  return run;
}

/**
 * Every absence in a match so far, oldest round first: a unit that was marked absent in a room of the column in play
 * or of an earlier round. Only the rows of the column in play can be taken back with "Mark as played".
 */
export function absentMatchRows(state: TournamentState): AbsentMatchRow[] {
  const labels = bracketRoundLabels(state);
  const column = currentColumn(state);
  const rows: AbsentMatchRow[] = [];
  for (let roundIndex = 0; roundIndex <= column.end; roundIndex += 1) {
    for (const room of occupiedRooms(state, roundIndex)) {
      for (const { unit, position } of absentSeats(state, roundIndex, room)) {
        rows.push({
          id: `${roundIndex}-${room}-${unit}`,
          unit,
          label: unitDisplay(state, unit).label,
          where: roundAndRoom(state, roundIndex, room, labels),
          roundIndex,
          room,
          keys: seatAbsenceKeys(state, roundIndex, room, position),
          canMarkPlayed: roundIndex >= column.start,
          latest: false,
          streak: 1,
        });
      }
    }
  }
  const roundsOf = new Map<string, Set<number>>();
  for (const row of rows) roundsOf.set(row.unit, (roundsOf.get(row.unit) ?? new Set()).add(row.roundIndex));
  const lastOf = new Map([...roundsOf].map(([unit, rounds]) => [unit, Math.max(...rounds)]));
  return rows.map((row) => {
    const latest = lastOf.get(row.unit) === row.roundIndex;
    return {
      ...row,
      latest,
      streak: latest ? runEndingAt(roundsOf.get(row.unit) ?? new Set(), row.roundIndex) : 1,
    };
  });
}

/** A member of a Survival team the organiser marked absent by hand (display only), with the seat it was marked in. */
export interface SurvivalMarkRow {
  id: string;
  /** "Ann (Red)". */
  label: string;
  where: string;
  roundIndex: number;
  room: number;
  position: number;
  memberIndex: number;
}

/** One team of the column in play with its members, for the "＋ Mark a member absent" picker. */
export interface SurvivalMarkChoice {
  unit: string;
  teamLabel: string;
  roundIndex: number;
  room: number;
  position: number;
  members: Array<{ memberIndex: number; name: string; marked: boolean }>;
}

function isSurvival(state: TournamentState): boolean {
  return (
    state.gamemodeConfig.absenceVersion === 1 && state.gamemodeConfig.teamScoringRule === 'survival-teams'
  );
}

/** The teams seated in the column in play, in seat order, with each member and whether it is marked. Empty outside Survival Teams. */
export function survivalMarkChoices(state: TournamentState): SurvivalMarkChoice[] {
  if (!isSurvival(state)) return [];
  const teams = buildTeamMap(state);
  const column = currentColumn(state);
  const choices: SurvivalMarkChoice[] = [];
  for (let roundIndex = column.start; roundIndex <= column.end; roundIndex += 1) {
    if (state.rounds[roundIndex]?.isFinal || state.rounds[roundIndex]?.bracket === 'grand-final') continue;
    for (const room of occupiedRooms(state, roundIndex)) {
      const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
      seated.forEach((entry, position) => {
        const team = teams[entry.name];
        if (!team) return;
        const members = team.members.flatMap((member, memberIndex) =>
          member
            ? [
                {
                  memberIndex,
                  name: member.name,
                  marked: isMemberMarkedAbsent(
                    state,
                    survivalMemberKey(roundIndex, room, position, memberIndex),
                  ),
                },
              ]
            : [],
        );
        choices.push({ unit: entry.name, teamLabel: team.teamName, roundIndex, room, position, members });
      });
    }
  }
  return choices;
}

/** The members marked absent by hand in the column in play, each with its team. */
export function survivalMarkRows(state: TournamentState): SurvivalMarkRow[] {
  const labels = bracketRoundLabels(state);
  return survivalMarkChoices(state).flatMap((choice) =>
    choice.members
      .filter((member) => member.marked)
      .map((member) => ({
        id: `${choice.roundIndex}-${choice.room}-${choice.position}-${member.memberIndex}`,
        label: `${member.name} (${choice.teamLabel})`,
        where: roundAndRoom(state, choice.roundIndex, choice.room, labels),
        roundIndex: choice.roundIndex,
        room: choice.room,
        position: choice.position,
        memberIndex: member.memberIndex,
      })),
  );
}
