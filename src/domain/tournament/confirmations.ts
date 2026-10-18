import { getGameFormat } from './formats';
import { buildTeamMap } from './roster';
import { finalScoreKey, scoreKeysForPosition, scoreOrDefault } from './scoring';
import type { TournamentState, TournamentTeam } from './types';

export type ConfirmationLevel = 'all' | 'some' | 'none';

/** Why a name counts as confirmed: the organiser marked it, or a score above 0 does (and locks it). */
export type ConfirmationSource = 'score' | 'manual' | null;

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

/**
 * The names with an individual score above 0, in a pooling or bracket room or in a Final, any game. Only where
 * scores belong to players: individual formats, and team formats scored as "sum of members" (a member's score
 * goes to whoever holds that slot now). Survival Teams (one score per team) and Save your Buddy (defender only)
 * give nobody a score of their own. Worked out from the stored scores, never saved.
 */
export function scoredPlayers(state: TournamentState): Set<string> {
  const scored = new Set<string>();
  const teamSize = getGameFormat(state.gameFormat)?.teamSize;
  if (teamSize && (state.gamemodeConfig.teamScoringRule ?? 'sum-members') !== 'sum-members') return scored;
  const teams = teamSize ? buildTeamMap(state) : {};
  /** `keys` run game by game, one per member for a team; the position within a team's keys is the member. */
  const note = (unit: string | undefined, keys: string[], scores: Record<string, string | number | null>) => {
    if (!unit) return;
    keys.forEach((key, index) => {
      if (!isPositive(scores[key])) return;
      const name = teamSize ? teams[unit]?.members?.[index % teamSize]?.name : unit;
      if (name) scored.add(name);
    });
  };
  const aliases = new Map(state.anonymousFinalists.map((entry) => [entry.realKey, entry.alias]));
  const members = teamSize ? Array.from({ length: teamSize }, (_, member) => member) : [undefined];
  state.assignments.forEach((assignments, roundIndex) => {
    const round = state.rounds[roundIndex];
    const numGames = round?.numGames && round.numGames > 1 ? round.numGames : 1;
    const seated: Record<number, number> = {};
    for (const { name, room } of assignments) {
      if (room !== null) {
        const position = (seated[room] = (seated[room] ?? -1) + 1);
        note(name, scoreKeysForPosition({ roundIndex, room, position, numGames, teamSize }), state.scores);
      }
      if (!round?.isFinal) continue;
      for (let game = 1; game <= (round.numGames ?? 0); game += 1) {
        const key = round.anonymousGames?.includes(game) ? (aliases.get(name) ?? name) : name;
        note(
          name,
          members.map((member) => finalScoreKey(game, key, member)),
          state.finalScores,
        );
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
): ConfirmationSource {
  if (scored.has(name)) return 'score';
  return isManuallyConfirmed(state, name) ? 'manual' : null;
}

export function isConfirmed(
  state: TournamentState,
  name: string,
  scored: ReadonlySet<string> = scoredPlayers(state),
): boolean {
  return confirmationSource(state, name, scored) !== null;
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
): TeamConfirmation {
  const names = team.members.flatMap((member) => (member ? [member.name] : []));
  const confirmed = names.filter((name) => isConfirmed(state, name, scored)).length;
  const total = names.length;
  const level = confirmed === 0 ? 'none' : confirmed === total ? 'all' : 'some';
  return { confirmed, total, level };
}

/** The organiser tools' header counts over the active roster; reserves are not in them. */
export function rosterConfirmationSummary(
  state: TournamentState,
  scored: ReadonlySet<string> = scoredPlayers(state),
): RosterConfirmationSummary {
  const entries = state.players;
  if (!entries.length || typeof entries[0] === 'string') {
    const names = entries as string[];
    return {
      confirmed: names.filter((name) => isConfirmed(state, name, scored)).length,
      total: names.length,
    };
  }
  const levels = (entries as TournamentTeam[]).map((team) => teamConfirmation(state, team, scored));
  return {
    confirmed: levels.reduce((sum, entry) => sum + entry.confirmed, 0),
    total: levels.reduce((sum, entry) => sum + entry.total, 0),
    teamsConfirmed: levels.filter((entry) => entry.level === 'all').length,
    teams: levels.length,
  };
}
