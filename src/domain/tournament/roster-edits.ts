import { moveConfirmation } from './confirmations';
import { withDefenderKeysMoved } from './defender-move';
import { moveBackMark } from './likely-absentees';
import { renameInSchedule } from './rename-unit';
import { findUnit, findUnstorableNames, isWithdrawnName, teamNames } from './roster';
import { roundInPlayOf } from './round-columns';
import { getDefenderIndex } from './scoring';
import type { TournamentState, TournamentTeam } from './types';

/** Edits to a unit that stays: renaming it or a team member, a team's other edits and its defender, and why a roster edit is refused. */

/** Why a rename or a swap of a roster unit is refused, the first of its checks that failed. */
export type RosterEditRefusal =
  | 'empty-name'
  | 'same-name'
  | 'duplicate-name'
  | 'withdrawn-name'
  | 'unstorable-name'
  | 'swap-closed'
  | 'not-in-play'
  | 'not-a-team-format';

/** "Done, with the new state", or the reason it was refused (the state is then not changed). */
export type RosterEditResult =
  { status: 'done'; state: TournamentState } | { status: 'refused'; reason: RosterEditRefusal };

export const refused = (reason: RosterEditRefusal): RosterEditResult => ({ status: 'refused', reason });

export function renameIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const result = renameIndividualResult(state, oldName, newName);
  return result.status === 'done' ? result.state : state;
}

export function renameIndividualResult(
  state: TournamentState,
  oldName: string,
  newName: string,
): RosterEditResult {
  const trimmed = newName.trim();
  if (!trimmed) return refused('empty-name');
  if (trimmed === oldName) return refused('same-name');
  if (findUnit(state.players, trimmed) !== undefined || findUnit(state.reserves, trimmed) !== undefined) {
    return refused('duplicate-name');
  }
  if (isWithdrawnName(state, trimmed)) return refused('withdrawn-name');
  if (findUnstorableNames([trimmed]).length) return refused('unstorable-name');
  const rename = (name: string) => (name === oldName ? trimmed : name);
  const finalScores: TournamentState['finalScores'] = {};
  for (const [key, score] of Object.entries(state.finalScores)) {
    const match = key.match(/^(game\d+)-(.*)$/u);
    finalScores[match?.[2] === oldName ? `${match[1]}-${trimmed}` : key] = score;
  }
  const renamed: TournamentState = {
    ...state,
    players: (state.players as string[]).map(rename),
    reserves: (state.reserves as string[]).map(rename),
    ...renameInSchedule(state, rename),
    tieResolutions: Object.fromEntries(
      Object.entries(state.tieResolutions).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(rename) : rename(value),
      ]),
    ),
    finalScores,
  };
  return {
    status: 'done',
    state: moveBackMark(moveConfirmation(renamed, oldName, trimmed), oldName, trimmed),
  };
}

export function updateTeam(
  state: TournamentState,
  teamId: string,
  updater: (team: TournamentTeam) => TournamentTeam,
): TournamentState {
  let refused = false;
  const players = (state.players as TournamentTeam[]).map((team) => {
    if (team.teamId !== teamId) return team;
    const updated = updater({ ...team, members: [...team.members] });
    // Only names the update introduced: a name stored before names were checked doesn't lock its team.
    const added = teamNames(updated).filter((name) => !teamNames(team).includes(name));
    refused = findUnstorableNames(added).length > 0;
    return updated;
  });
  return refused ? state : { ...state, players };
}

/** Renames one team member; their confirmation follows the new spelling. */
export function renameTeamMember(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  newName: string,
): TournamentState {
  const trimmed = newName.trim();
  const team = findUnit(state.players, teamId);
  const oldName = typeof team === 'object' ? team.members[memberIndex]?.name : undefined;
  if (!oldName || !trimmed || trimmed === oldName) return state;
  const renamed = updateTeam(state, teamId, (entry) => ({
    ...entry,
    members: entry.members.map((item, index) =>
      index === memberIndex && item ? { ...item, name: trimmed } : item,
    ),
  }));
  return renamed === state
    ? state
    : moveBackMark(moveConfirmation(renamed, oldName, trimmed), oldName, trimmed);
}

export function setTeamDefender(state: TournamentState, teamId: string, memberIdx: number): TournamentState {
  const changes = (state.defenderChanges[teamId] ?? []).map((entry) => ({ ...entry }));
  const round = roundInPlayOf(state, teamId);
  const previous = getDefenderIndex(state, teamId, round);
  const existing = changes.find((entry) => entry.round === round);
  if (existing) existing.memberIdx = memberIdx;
  else changes.push({ round, memberIdx });
  return {
    ...withDefenderKeysMoved(state, teamId, round, previous, memberIdx),
    defenderChanges: { ...state.defenderChanges, [teamId]: changes },
  };
}
