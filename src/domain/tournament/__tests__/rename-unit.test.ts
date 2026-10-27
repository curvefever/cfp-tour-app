import { describe, expect, it } from 'vitest';
import { renameIndividual } from '../mutations';
import { createDefaultTournamentState } from '../state-defaults';
import type { TournamentStanding } from '../types';
import { buildAssignments, buildRound } from './test-fixtures';

/** A running tournament that holds "Oscar" in every place the schedule stores a name. */
function running() {
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: ['Oscar', 'Pia', 'Quinn', 'Rae'],
    rounds: [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4 }),
      {
        ...buildRound({ roundNum: 2, rooms: [2], players: 4 }),
        fixedRoomAssignments: buildAssignments(['Oscar', 'Quinn'], [1, 1]),
        matches: [{ group: 'A', pair: ['Oscar', 'Pia'] }],
        groupByes: ['Oscar'],
      },
    ],
    assignments: [buildAssignments(['Oscar', 'Pia', 'Quinn', 'Rae'], [1, 1, 2, 2])],
    byes: [['Oscar'], []],
    poolingByeCounts: { Oscar: 1, Pia: 0 },
    roomHistory: { 'Oscar|Pia': 0, 'Quinn|Rae': 0 },
    pendingBracketSeeds: { '1': [{ name: 'Oscar', tierRank: 1, pct: 0.5 }] },
    qualTable: [{ name: 'Oscar' } as TournamentStanding],
    groups: [{ label: 'A', members: ['Oscar', 'Pia'] }],
    groupStandings: { A: [{ name: 'Oscar' } as TournamentStanding] },
    luckyLosers: [['Oscar']],
    anonymousFinalists: [{ alias: 'Finalist-1', realKey: 'Oscar', connected: true }],
  });
}

describe('renameIndividual reaches every stored name', () => {
  it('leaves no trace of the old name anywhere in the state', () => {
    const result = renameIndividual(running(), 'Oscar', 'Ozzy');
    expect(JSON.stringify(result)).not.toContain('Oscar');
  });

  it('renames each place', () => {
    const result = renameIndividual(running(), 'Oscar', 'Ozzy');
    expect(result.rounds[1]?.fixedRoomAssignments?.map((entry) => entry.name)).toEqual(['Ozzy', 'Quinn']);
    expect(result.rounds[1]?.matches?.[0]?.pair).toEqual(['Ozzy', 'Pia']);
    expect(result.rounds[1]?.groupByes).toEqual(['Ozzy']);
    expect(result.byes).toEqual([['Ozzy'], []]);
    expect(result.poolingByeCounts).toEqual({ Ozzy: 1, Pia: 0 });
    expect(result.pendingBracketSeeds['1']?.[0]?.name).toBe('Ozzy');
    expect(result.groups[0]?.members).toEqual(['Ozzy', 'Pia']);
    expect(result.groupStandings.A?.[0]?.name).toBe('Ozzy');
    expect(result.anonymousFinalists[0]?.realKey).toBe('Ozzy');
  });

  it('re-sorts a room history pair the new name moves', () => {
    const result = renameIndividual(running(), 'Oscar', 'Zed');
    expect(result.roomHistory).toEqual({ 'Pia|Zed': 0, 'Quinn|Rae': 0 });
  });

  it('keeps the rounds of a state without fixed draws or groups as they were', () => {
    const result = renameIndividual(running(), 'Rae', 'Ray');
    expect(result.rounds[0]).toEqual(running().rounds[0]);
    expect(result.rounds[0]).not.toHaveProperty('matches');
  });
});
