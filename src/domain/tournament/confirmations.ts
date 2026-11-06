import { isMarkedAbsent, usesAbsences } from './absences';
import { getGameFormat, isOneScorePerTeam } from './formats';
import { absenceMarks, markBack, unmarkBack, type AbsenceMarks } from './likely-absentees';
import { buildTeamMap } from './roster';
import { finalScoreKey, scoreKeysForPosition, scoreOrDefault } from './scoring';
import type { TournamentState, TournamentTeam } from './types';

export type ConfirmationLevel = 'all' | 'some' | 'none';

/**
 * Why a name counts as confirmed: a score of play (it locks the mark), the organiser's mark, or having been marked
 * back from an absence. A player of a unit likely absent (`absenceMarks`) counts as confirmed for none of them.
 */
export type ConfirmationSource = 'score' | 'manual' | 'back' | null;

export interface TeamConfirmation {
  confirmed: number;
  total: number;
  level: ConfirmationLevel;
}

export interface RosterConfirmationSummary {
  confirmed: number;
  total: number;
  /** Team formats only: teams whose members are all confirmed, and the number of teams. */
  teamsConfirmed?: number;
  teams?: number;
}

const isPositive = (raw: string | number | null | undefined) => (scoreOrDefault(raw, null) ?? 0) > 0;

/** The organiser's own mark, whatever the scores say. */
export function isManuallyConfirmed(state: TournamentState, name: string): boolean {
  return state.confirmations[name] === true;
}

/** A score of play: above 0, or a 0 the organiser answered "played" (One score per team never asks, so its 0 counts too). */
function isScoreOfPlay(state: TournamentState, key: string): boolean {
  const score = scoreOrDefault(state.scores[key], null);
  if (score === null || isMarkedAbsent(state, key)) return false;
  if (score > 0) return true;
  return usesAbsences(state) && (isOneScorePerTeam(state) || state.absences?.[key] === 'played');
}

/**
 * The names with a score of play in a pooling or bracket room or in a Final, any game: an individual's own score;
 * for a team format scored as "sum of members" the member who scored (a member's score goes to whoever holds that
 * slot now), and for every other team scoring rule (One score per team, Save your Buddy) every member of a team that
 * has one. A 0 counts only when it was answered "played" (or in One score per team). Worked out from the stored
 * scores, never saved.
 */
export function scoredPlayers(state: TournamentState): Set<string> {
  const scored = new Set<string>();
  const teamSize = getGameFormat(state.gameFormat)?.teamSize;
  const oneScore = isOneScorePerTeam(state);
  const perMember =
    Boolean(teamSize) && (state.gamemodeConfig.teamScoringRule ?? 'sum-members') === 'sum-members';
  const teams = teamSize ? buildTeamMap(state) : {};
  /** `keys` run game by game, one per member for a team; the position within a team's keys is the member. */
  const note = (unit: string | undefined, keys: string[], counts: (key: string) => boolean) => {
    if (!unit) return;
    keys.forEach((key, index) => {
      if (!counts(key)) return;
      if (!teamSize) scored.add(unit);
      else if (perMember) {
        const name = teams[unit]?.members?.[index % teamSize]?.name;
        if (name) scored.add(name);
      } else {
        for (const member of teams[unit]?.members ?? []) if (member) scored.add(member.name);
      }
    });
  };
  const aliases = new Map(state.anonymousFinalists.map((entry) => [entry.realKey, entry.alias]));
  const finalMembers =
    !teamSize || oneScore ? [undefined] : Array.from({ length: teamSize }, (_, member) => member);
  const keysPerSeat = teamSize && !oneScore ? teamSize : undefined;
  state.assignments.forEach((assignments, roundIndex) => {
    const round = state.rounds[roundIndex];
    const numGames = round?.numGames && round.numGames > 1 ? round.numGames : 1;
    const seated: Record<number, number> = {};
    for (const { name, room } of assignments) {
      if (room !== null) {
        const position = (seated[room] = (seated[room] ?? -1) + 1);
        const keys = scoreKeysForPosition({ roundIndex, room, position, numGames, teamSize: keysPerSeat });
        note(name, keys, (key) => isScoreOfPlay(state, key));
      }
      if (!round?.isFinal) continue;
      for (let game = 1; game <= (round.numGames ?? 0); game += 1) {
        const key = round.anonymousGames?.includes(game) ? (aliases.get(name) ?? name) : name;
        const keys = finalMembers.map((member) => finalScoreKey(game, key, member));
        note(name, keys, (finalKey) => isPositive(state.finalScores[finalKey]));
      }
    }
  });
  return scored;
}

/** The scored names are worked out per call unless the caller passes them, so a panel passes one set to every row. */
export function confirmationSource(
  state: TournamentState,
  name: string,
  scored: ReadonlySet<string> = scoredPlayers(state),
  marks: AbsenceMarks = absenceMarks(state),
): ConfirmationSource {
  if (marks.absent.has(name)) return null;
  if (marks.back.has(name)) return 'back';
  if (scored.has(name)) return 'score';
  return isManuallyConfirmed(state, name) ? 'manual' : null;
}

export function isConfirmed(
  state: TournamentState,
  name: string,
  scored: ReadonlySet<string> = scoredPlayers(state),
  marks: AbsenceMarks = absenceMarks(state),
): boolean {
  return confirmationSource(state, name, scored, marks) !== null;
}

/**
 * What a click on a name's toggle does: a likely absentee's "?" marks it back (and confirms it), a back mark's check
 * takes the mark away, and any other toggle confirms or unconfirms by hand.
 */
export function clickConfirmation(state: TournamentState, name: string): TournamentState {
  const marks = absenceMarks(state);
  if (marks.absent.has(name)) return setConfirmed(markBack(state, name), name, true);
  if (marks.back.has(name)) return unmarkBack(state, name);
  return setConfirmed(state, name, !isManuallyConfirmed(state, name));
}

/** Marks or unmarks a name by hand; the same state object comes back when nothing changes. */
export function setConfirmed(state: TournamentState, name: string, confirmed: boolean): TournamentState {
  if (isManuallyConfirmed(state, name) === confirmed) return state;
  if (confirmed) return { ...state, confirmations: { ...state.confirmations, [name]: true } };
  const { [name]: _removed, ...rest } = state.confirmations;
  return { ...state, confirmations: rest };
}

/** A rename keeps the person, so their manual confirmation follows the new spelling. */
export function moveConfirmation(state: TournamentState, oldName: string, newName: string): TournamentState {
  if (!isManuallyConfirmed(state, oldName)) return state;
  return setConfirmed(setConfirmed(state, oldName, false), newName, true);
}

/** How many of a team's members are confirmed; vacant slots are not counted. */
export function teamConfirmation(
  state: TournamentState,
  team: TournamentTeam,
  scored: ReadonlySet<string> = scoredPlayers(state),
  marks: AbsenceMarks = absenceMarks(state),
): TeamConfirmation {
  const names = team.members.flatMap((member) => (member ? [member.name] : []));
  const confirmed = names.filter((name) => isConfirmed(state, name, scored, marks)).length;
  const total = names.length;
  const level = confirmed === 0 ? 'none' : confirmed === total ? 'all' : 'some';
  return { confirmed, total, level };
}

/** The organiser tools' header counts over the active roster; reserves are not in them. */
export function rosterConfirmationSummary(
  state: TournamentState,
  scored: ReadonlySet<string> = scoredPlayers(state),
  marks: AbsenceMarks = absenceMarks(state),
): RosterConfirmationSummary {
  const entries = state.players;
  if (!entries.length || typeof entries[0] === 'string') {
    const names = entries as string[];
    return {
      confirmed: names.filter((name) => isConfirmed(state, name, scored, marks)).length,
      total: names.length,
    };
  }
  const levels = (entries as TournamentTeam[]).map((team) => teamConfirmation(state, team, scored, marks));
  return {
    confirmed: levels.reduce((sum, entry) => sum + entry.confirmed, 0),
    total: levels.reduce((sum, entry) => sum + entry.total, 0),
    teamsConfirmed: levels.filter((entry) => entry.level === 'all').length,
    teams: levels.length,
  };
}
