import { describe, expect, it } from 'vitest';
import { emptySchedule } from '../empty-schedule';
import { createDefaultTournamentState } from '../state-defaults';

describe('emptySchedule', () => {
  it('is the value every part of a schedule has in a tournament with nothing generated', () => {
    const fresh = createDefaultTournamentState();
    expect(emptySchedule()).toEqual({
      rounds: fresh.rounds,
      curRound: fresh.curRound,
      started: fresh.started,
      gamemodeConfig: fresh.gamemodeConfig,
      groups: fresh.groups,
      groupStandings: fresh.groupStandings,
      qualTable: fresh.qualTable,
      assignments: fresh.assignments,
      luckyLosers: fresh.luckyLosers,
      byes: fresh.byes,
      poolingByeCounts: fresh.poolingByeCounts,
      roomHistory: fresh.roomHistory,
      pendingBracketSeeds: fresh.pendingBracketSeeds,
      scores: fresh.scores,
      finalScores: fresh.finalScores,
      tieResolutions: fresh.tieResolutions,
      absences: fresh.absences,
      backFromAbsence: fresh.backFromAbsence,
      waterfallSteps: fresh.waterfallSteps,
      defenderChanges: fresh.defenderChanges,
      anonymousFinalists: fresh.anonymousFinalists,
    });
  });

  it('gives new lists and objects each time, so a writer to one schedule cannot touch another', () => {
    const first = emptySchedule();
    first.assignments[0] = [{ name: 'A', room: 1, isLucky: false }];
    first.poolingByeCounts.A = 1;
    first.roomHistory.x = 0;
    const second = emptySchedule();
    expect(second.assignments).toEqual([]);
    expect(second.poolingByeCounts).toEqual({});
    expect(second.roomHistory).toEqual({});
  });
});
