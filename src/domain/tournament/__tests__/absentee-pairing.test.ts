import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import { deriveRoomSize, getGameFormat } from '../formats';
import { likelyAbsentees } from '../likely-absentees';
import { pairsAbsenteesInRound } from '../seeding';
import { scoreKey, scoredMemberSlots, scoredTeamSize } from '../scoring';
import { swissPair } from '../swiss-pairing';
import type { RoundAssignment, TournamentState } from '../types';
import { pressed, scoreRound } from './dependency-play-fixtures';
import { swiss } from './swiss-source-fixtures';
import { generated } from './test-fixtures';

/**
 * Pairing likely absentees together in head-to-head pooling draws (`absenceVersion` 4): never in the first round, the
 * absentees share rooms of their own, a leftover one takes the bye (worth no points, `absentBye`), and the present
 * units are paired exactly as without them.
 */

const FORMATS = [
  { label: '1v1', setup: { gameFormat: 'individual-1v1' as const } },
  {
    label: '3v3 Save your Buddy',
    setup: { gameFormat: 'team-3v3' as const, teamScoringRule: 'designated-player' as const },
  },
];

/** Round 1 scored, with `absent` answered absent in it: they are the likely absentees of round 2. */
function afterRoundOne(state: TournamentState, absent: string[]): TournamentState {
  let working = scoreRound(state, 0);
  const keys: string[] = [];
  for (const unit of absent) {
    const entries = (working.assignments[0] ?? []).filter((entry) => entry.room !== null);
    const entry = entries.find((candidate) => candidate.name === unit);
    if (!entry || entry.room === null) throw new Error(`${unit} has no room in round 1`);
    const position = entries.filter((other) => other.room === entry.room).indexOf(entry);
    const teamSize = scoredTeamSize(working);
    const slots = teamSize ? scoredMemberSlots(working, unit, 0, teamSize) : [undefined];
    for (const slot of slots) {
      const key = scoreKey(0, entry.room, position, null, slot ?? null);
      working = { ...working, scores: { ...working.scores, [key]: 0 } };
      keys.push(key);
    }
  }
  return answerAbsence(working, keys, 'absent');
}

/** The first units of round 1's rooms: a mix of rooms and standings for the absentees. */
function pickAbsent(state: TournamentState, count: number): string[] {
  const rooms = new Map<number, string[]>();
  for (const entry of state.assignments[0] ?? []) {
    if (entry.room !== null) rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), entry.name]);
  }
  return [...rooms.values()].slice(0, count).map((names) => names[1]);
}

const roomsOf = (assignments: RoundAssignment[]): string[][] => {
  const byRoom = new Map<number, string[]>();
  for (const entry of assignments) {
    if (entry.room !== null) byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
  }
  return [...byRoom.entries()].sort(([a], [b]) => a - b).map(([, names]) => names);
};
const byeOf = (assignments: RoundAssignment[]) => assignments.find((entry) => entry.room === null);
const absentRooms = (assignments: RoundAssignment[], absent: Set<string>) =>
  roomsOf(assignments).filter((names) => names.every((name) => absent.has(name)));
const mixedRooms = (assignments: RoundAssignment[], absent: Set<string>) =>
  roomsOf(assignments).filter(
    (names) => names.some((name) => absent.has(name)) && !names.every((name) => absent.has(name)),
  );

function draw(state: TournamentState, absent: Set<string>, names?: string[]) {
  const roomSize = deriveRoomSize(getGameFormat(state.gameFormat) as never);
  return swissPair({
    activeNames: names ?? (state.assignments[0] ?? []).map((entry) => entry.name),
    throughRoundIndex: 0,
    roomSize,
    state,
    likelyAbsent: absent,
  });
}

describe.each(FORMATS)('a Swiss of $label', ({ setup }) => {
  describe('an even field of 14', () => {
    const start = swiss(14, setup);
    const absentOf = (count: number) => {
      const units = pickAbsent(start, count);
      const state = afterRoundOne(start, units);
      return { state, absent: new Set(units), likely: likelyAbsentees(state, 1) };
    };

    it('pairs 2 absentees together', () => {
      const { state, absent, likely } = absentOf(2);
      expect(likely).toEqual(absent);
      const { seeded, byeName } = draw(state, likely);
      expect(byeName).toBeNull();
      expect(absentRooms(seeded, absent)).toHaveLength(1);
      expect(mixedRooms(seeded, absent)).toHaveLength(0);
    });

    it('pairs 2 of 3 absentees together, and the third meets a present unit', () => {
      const { state, absent, likely } = absentOf(3);
      const { seeded } = draw(state, likely);
      expect(absentRooms(seeded, absent)).toHaveLength(1);
      expect(mixedRooms(seeded, absent)).toHaveLength(1);
    });

    it('makes two absentee rooms of 4 absentees', () => {
      const { state, absent, likely } = absentOf(4);
      const { seeded } = draw(state, likely);
      expect(absentRooms(seeded, absent)).toHaveLength(2);
      expect(mixedRooms(seeded, absent)).toHaveLength(0);
    });

    it('numbers the absentee rooms after the present ones', () => {
      const { state, absent, likely } = absentOf(2);
      const rooms = roomsOf(draw(state, likely).seeded);
      expect(rooms.slice(-1)[0].every((name) => absent.has(name))).toBe(true);
    });

    it('pairs the present units as it does over the field without the absentees', () => {
      const { state, absent, likely } = absentOf(2);
      const { seeded } = draw(state, likely);
      const present = (state.assignments[0] ?? [])
        .map((entry) => entry.name)
        .filter((name) => !absent.has(name));
      const reduced = draw(state, new Set(), present).seeded;
      expect(roomsOf(seeded).filter((names) => !names.every((name) => absent.has(name)))).toEqual(
        roomsOf(reduced),
      );
    });

    it('pairs two absentees who have met with other absentees while one pairing has no rematch', () => {
      const rooms = roomsOf(start.assignments[0] ?? []);
      const units = [...rooms[0], ...rooms[1]];
      const state = afterRoundOne(start, units);
      const { seeded } = draw(state, likelyAbsentees(state, 1));
      const together = absentRooms(seeded, new Set(units));
      expect(together).toHaveLength(2);
      for (const room of together) {
        const key = [...room].sort().join('|');
        expect([[...rooms[0]].sort().join('|'), [...rooms[1]].sort().join('|')]).not.toContain(key);
      }
    });

    it('changes nothing in the first round: no absentee, no pairing', () => {
      expect(likelyAbsentees(start, 0).size).toBe(0);
      expect(pairsAbsenteesInRound(start, start.rounds[0], 0)).toBe(false);
    });
  });

  describe('an odd field of 13', () => {
    const start = swiss(13, setup);
    const run = (count: number) => {
      const units = pickAbsent(start, count);
      const state = afterRoundOne(start, units);
      const absent = new Set(units);
      return { state, absent, result: draw(state, likelyAbsentees(state, 1)) };
    };

    it('gives 1 absentee the bye, flagged absentBye', () => {
      const { absent, result } = run(1);
      const bye = byeOf(result.seeded);
      expect(bye).toMatchObject({ room: null, absentBye: true });
      expect(absent.has(bye?.name as string)).toBe(true);
      expect(result.poolingByeCounts[bye?.name as string]).toBe(1);
    });

    it('pairs 2 absentees and leaves the bye to a present unit, without the flag', () => {
      const { absent, result } = run(2);
      expect(absentRooms(result.seeded, absent)).toHaveLength(1);
      const bye = byeOf(result.seeded);
      expect(bye?.absentBye).toBeUndefined();
      expect(absent.has(bye?.name as string)).toBe(false);
    });

    it('gives the lowest of 3 absentees the bye and pairs the other two', () => {
      const { absent, result } = run(3);
      expect(absentRooms(result.seeded, absent)).toHaveLength(1);
      expect(byeOf(result.seeded)).toMatchObject({ absentBye: true });
      expect(mixedRooms(result.seeded, absent)).toHaveLength(0);
    });
  });

  it('draws a version 3 tournament exactly as before', () => {
    const start = swiss(14, setup);
    const units = pickAbsent(start, 2);
    const old = {
      ...afterRoundOne(start, units),
    };
    const v3: TournamentState = { ...old, gamemodeConfig: { ...old.gamemodeConfig, absenceVersion: 3 } };
    const advanced = pressed(v3);
    const before = draw(v3, new Set()).seeded;
    expect(roomsOf(advanced.assignments[1])).toEqual(roomsOf(before));
    const v4 = pressed(old);
    expect(absentRooms(v4.assignments[1], new Set(units))).toHaveLength(1);
  });
});

describe('a head-to-head qualification table', () => {
  it.each([31, 37])('pairs 2 absentees of %i players in round 2, and a present unit has the bye', (count) => {
    const start = withoutSwiss(count);
    const units = pickAbsent(start, 2);
    const next = pressed(afterRoundOne(start, units));
    const absent = new Set(units);
    expect(absentRooms(next.assignments[1], absent)).toHaveLength(1);
    expect(byeOf(next.assignments[1])?.absentBye).toBeUndefined();
  });

  it.each([31, 37])('gives the lowest of 3 absentees of %i players the bye, flagged', (count) => {
    const start = withoutSwiss(count);
    const units = pickAbsent(start, 3);
    const next = pressed(afterRoundOne(start, units));
    const absent = new Set(units);
    expect(absentRooms(next.assignments[1], absent)).toHaveLength(1);
    expect(byeOf(next.assignments[1])).toMatchObject({ absentBye: true });
    expect(absent.has(byeOf(next.assignments[1])?.name as string)).toBe(true);
  });

  it('pairs the absentees of the second warm-up of a "None" tournament', () => {
    const start = started(generated(16, { gameFormat: 'individual-1v1', poolingPhase: 'none' }));
    const units = pickAbsent(start, 2);
    const next = pressed(afterRoundOne(start, units));
    expect(absentRooms(next.assignments[1], new Set(units))).toHaveLength(1);
  });
});

describe('what is left as it was', () => {
  it('does not pair in an elimination round, a Custom bracket round or the first round', () => {
    const state = started(generated(16, { gameFormat: 'individual-1v1', poolingPhase: 'none' }));
    const elimination = state.rounds.findIndex(
      (round) => !round.isNoElim && !round.isFinal && !round.isSemis,
    );
    expect(elimination).toBeGreaterThan(0);
    expect(pairsAbsenteesInRound(state, state.rounds[elimination], elimination)).toBe(false);
    expect(pairsAbsenteesInRound(state, state.rounds[0], 0)).toBe(false);
    expect(pairsAbsenteesInRound(state, state.rounds[1], 1)).toBe(true);
    const custom = { ...state.rounds[1], isWaterfall: true, isNoElim: false };
    expect(pairsAbsenteesInRound(state, custom, 3)).toBe(false);
  });
});

function started(state: TournamentState): TournamentState {
  return { ...state, started: true };
}

function withoutSwiss(count: number): TournamentState {
  return started(generated(count, { gameFormat: 'individual-1v1', poolingPhase: 'qual-table' }));
}
