import type { TournamentState, TournamentTeam } from './types';

export type ConfirmationLevel = 'all' | 'some' | 'none';

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

export function isConfirmed(state: TournamentState, name: string): boolean {
  return state.confirmations[name] === true;
}

/** Marks or unmarks a name; the same state object comes back when nothing changes. */
export function setConfirmed(state: TournamentState, name: string, confirmed: boolean): TournamentState {
  if (isConfirmed(state, name) === confirmed) return state;
  if (confirmed) return { ...state, confirmations: { ...state.confirmations, [name]: true } };
  const { [name]: _removed, ...rest } = state.confirmations;
  return { ...state, confirmations: rest };
}

/** A rename keeps the person, so their confirmation follows the new spelling. */
export function moveConfirmation(state: TournamentState, oldName: string, newName: string): TournamentState {
  if (!isConfirmed(state, oldName)) return state;
  return setConfirmed(setConfirmed(state, oldName, false), newName, true);
}

/** How many of a team's members are confirmed; vacant slots are not counted. */
export function teamConfirmation(state: TournamentState, team: TournamentTeam): TeamConfirmation {
  const names = team.members.flatMap((member) => (member ? [member.name] : []));
  const confirmed = names.filter((name) => isConfirmed(state, name)).length;
  const total = names.length;
  const level = confirmed === 0 ? 'none' : confirmed === total ? 'all' : 'some';
  return { confirmed, total, level };
}

/** The organiser tools' header counts over the active roster; reserves are not in them. */
export function rosterConfirmationSummary(state: TournamentState): RosterConfirmationSummary {
  const entries = state.players;
  if (!entries.length || typeof entries[0] === 'string') {
    const names = entries as string[];
    return { confirmed: names.filter((name) => isConfirmed(state, name)).length, total: names.length };
  }
  const levels = (entries as TournamentTeam[]).map((team) => teamConfirmation(state, team));
  return {
    confirmed: levels.reduce((sum, entry) => sum + entry.confirmed, 0),
    total: levels.reduce((sum, entry) => sum + entry.total, 0),
    teamsConfirmed: levels.filter((entry) => entry.level === 'all').length,
    teams: levels.length,
  };
}
