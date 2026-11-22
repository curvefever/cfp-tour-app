import { describe, expect, it } from 'vitest';
import { removeTeamMember } from '../member-swaps';
import { setTeamDefender } from '../mutations';
import { roomOfUnit } from './vacant-slot-fixtures';
import { findUnit } from '../roster';
import { roundsInPlay } from '../round-columns';
import {
  finalScoreKey,
  getDefenderIndex,
  getFinalUnitScore,
  getUnitScore,
  isRoomScored,
  scoredMemberSlots,
} from '../scoring';
import type { TournamentState, TournamentTeam } from '../types';
import { playColumns, pressed, scoreRound } from './dependency-play-fixtures';
import { atEntry, swiss } from './swiss-source-fixtures';

/**
 * Removing a team member (`removeTeamMember`): the slot goes vacant, the Save your Buddy defender never sits on it, and
 * with `vacantSlotVersion` the slot keeps the scores it played in every round.
 */

const SYB = { gameFormat: 'team-3v3', teamScoringRule: 'designated-player' } as const;
const SUM = { gameFormat: 'team-3v3', teamScoringRule: 'sum-members' } as const;

/** The Swiss played through `rounds` rounds, so the next round is the one in play. */
function playedRounds(count: number, setup: typeof SYB | typeof SUM, rounds: number): TournamentState {
  let state = swiss(count, setup);
  for (let round = 0; round < rounds; round += 1) state = pressed(scoreRound(state, state.curRound));
  return state;
}

/** Every unit of the rounds before `before`, with the score each reads. */
function pastScores(state: TournamentState, before: number): Array<[number, string, number | null]> {
  return Array.from({ length: before }, (_, round) => round).flatMap((round) =>
    (state.assignments[round] ?? []).flatMap((entry) => {
      if (entry.room === null) return [];
      const position = (state.assignments[round] ?? [])
        .filter((other) => other.room === entry.room)
        .indexOf(entry);
      return [
        [round, entry.name, getUnitScore(state, round, entry.room, position, null)] as [
          number,
          string,
          number | null,
        ],
      ];
    }),
  );
}

const teamIn = (state: TournamentState, teamId: string) => findUnit(state.players, teamId) as TournamentTeam;
const firstTeam = (state: TournamentState) => (state.assignments[state.curRound] ?? [])[0].name;
const withoutVersion = (state: TournamentState): TournamentState => {
  const { vacantSlotVersion: _version, ...config } = state.gamemodeConfig;
  return { ...state, gamemodeConfig: config };
};

describe.each([13, 14])('a 3v3 Save your Buddy Swiss of %i teams', (count) => {
  const state = playedRounds(count, SYB, 3);
  const id = firstTeam(state);

  function removed(from: TournamentState, slot: number) {
    const result = removeTeamMember(from, id, slot);
    if (typeof result === 'string') throw new Error(result);
    return result;
  }

  it('moves the defender to the first filled slot, names it, and leaves the past rounds as they were', () => {
    expect(getDefenderIndex(state, id, state.curRound)).toBe(0);
    const { state: after, newDefender } = removed(state, 0);
    expect(newDefender).toBe(teamIn(state, id).members[1]?.name);
    expect(getDefenderIndex(after, id, after.curRound)).toBe(1);
    expect(teamIn(after, id).members[0]).toBeNull();
    expect(pastScores(after, 3)).toEqual(pastScores(state, 3));
  });

  it('moves a defender at slot 2 to slot 0', () => {
    const atTwo = setTeamDefender(state, id, 2);
    expect(getDefenderIndex(atTwo, id, atTwo.curRound)).toBe(2);
    const { state: after, newDefender } = removed(atTwo, 2);
    expect(getDefenderIndex(after, id, after.curRound)).toBe(0);
    expect(newDefender).toBe(teamIn(state, id).members[0]?.name);
  });

  it('moves the score typed in the round in play with the defender, and the room stays scored', () => {
    const scored = scoreRound(state, state.curRound);
    const room = roomOfUnit(scored, scored.curRound, id);
    expect(isRoomScored(scored, scored.curRound, room)).toBe(true);
    const { state: after } = removed(scored, 0);
    expect(
      Object.keys(after.scores).some(
        (key) => key.startsWith(`r${after.curRound}-rm${room}-`) && key.endsWith('-m1'),
      ),
    ).toBe(true);
    expect(isRoomScored(after, after.curRound, room)).toBe(true);
  });

  it('changes no defender when a teammate is removed', () => {
    const { state: after, newDefender } = removed(state, 2);
    expect(newDefender).toBeNull();
    expect(after.defenderChanges).toEqual(state.defenderChanges);
    expect(getDefenderIndex(after, id, after.curRound)).toBe(0);
  });

  it('answers null for the last member removed, without throwing', () => {
    const first = removed(state, 0);
    const second = removed(first.state, 1);
    expect(second.newDefender).toBe(teamIn(state, id).members[2]?.name);
    const last = removed(second.state, 2);
    expect(last.newDefender).toBeNull();
    expect(teamIn(last.state, id).members).toEqual([null, null, null]);
  });

  it('refuses a vacant or unknown slot, and an unknown team', () => {
    const { state: after } = removed(state, 2);
    expect(removeTeamMember(after, id, 2)).toBe('That slot is already vacant.');
    expect(removeTeamMember(state, 'nobody', 0)).toBe("That team isn't in the tournament.");
  });

  it('reads the past rounds 0 for the same removal without vacantSlotVersion (the earlier rule)', () => {
    const old = withoutVersion(state);
    const { state: after } = removed(old, 0);
    expect(pastScores(after, 3)).not.toEqual(pastScores(old, 3));
  });
});

describe('Sum of members, a member removed after round 2', () => {
  const state = playedRounds(13, SUM, 2);
  const id = firstTeam(state);

  it("keeps the member's points in rounds 1 and 2 and counts the slot as 0, never missing, from then on", () => {
    const result = removeTeamMember(state, id, 1);
    if (typeof result === 'string') throw new Error(result);
    expect(result.newDefender).toBeNull();
    expect(pastScores(result.state, 2)).toEqual(pastScores(state, 2));
    const scored = scoreRound(result.state, result.state.curRound);
    const room = roomOfUnit(scored, scored.curRound, id);
    expect(isRoomScored(scored, scored.curRound, room)).toBe(true);
    // Before anyone scores, the round in play reads missing only for the slots that are filled.
    expect(roundsInPlay(result.state)).toContain(result.state.curRound);
  });

  it("reads the earlier rule without the switch: the removed member's past points are gone", () => {
    const old = withoutVersion(state);
    const result = removeTeamMember(old, id, 1);
    if (typeof result === 'string') throw new Error(result);
    expect(pastScores(result.state, 2)).not.toEqual(pastScores(old, 2));
  });
});

describe('a Save your Buddy finalist whose defender is removed before the Final is scored', () => {
  it("reads the new defender's slot in the Final", () => {
    const final = playColumns(atEntry(swiss(13, SYB)));
    const index = final.rounds.findIndex((round) => round.isFinal);
    const id = final.assignments[index][0].name;
    expect(scoredMemberSlots(final, id, index, 3)).toEqual([0]);
    const result = removeTeamMember(final, id, 0);
    if (typeof result === 'string') throw new Error(result);
    const after = result.state;
    expect(scoredMemberSlots(after, id, index, 3)).toEqual([1]);
    const typed = { ...after, finalScores: { ...after.finalScores, [finalScoreKey(1, id, 1)]: 321 } };
    expect(getFinalUnitScore(typed, id, 1, null)).toBe(321);
  });
});
