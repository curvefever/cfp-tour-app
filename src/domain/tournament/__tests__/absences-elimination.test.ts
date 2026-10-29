import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import {
  buildAdvancementTiers,
  doubleEliminationComputeAdvancement,
  kingsValleyComputeAdvancement,
  roomFinishOrder,
} from '../advancement';
import { routeWaterfallRound } from '../bracket-replay';
import { fairCutAdvancement, roundLineUps } from '../fair-cut';
import { removeRosterUnit } from '../mutations';
import { createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { type Absent, firstEliminationIndex, generate, playedRound, SE_FFA } from './fair-cut-fixtures';
import { buildAssignments, buildRound } from './test-fixtures';

const names = (room: number, positions: number[]) => positions.map((position) => `R${room}P${position + 1}`);

describe('53 FFA, first cut of a single elimination', () => {
  const start = () => generate('FFA 53', 53, SE_FFA);
  const roundIndex = () => firstEliminationIndex(start());
  const threeAbsent: Absent = { 1: [5, 6, 7] };

  it('advances exactly the planned number, eliminates the absentees and groups the rooms by present size', () => {
    const state = playedRound(start(), roundIndex(), threeAbsent);
    const round = state.rounds[roundIndex()];
    expect(round.advTotal).toBe(43);
    expect(roundLineUps(state, roundIndex())).toEqual([5, 8, 8, 8, 7, 7, 7]);

    const result = fairCutAdvancement(state, roundIndex());
    expect(result.advancing).toHaveLength(43);
    for (const name of names(1, [5, 6, 7])) expect(result.eliminated).toContain(name);
    expect(result.advancing.map((entry) => entry.name)).toContain('R1P1');
    expect(result.eliminated).toHaveLength(53 - 43);
    expect(result.groups.map((group) => group.size)).toEqual([8, 7, 5]);
    expect(result.groups.find((group) => group.size === 5)?.rooms).toEqual([1]);
  });

  it('keeps nobody out of the cut but the absentees when there are more of them than eliminations: everyone present advances and the next round is short', () => {
    const absent: Absent = { 1: [4, 5, 6, 7], 2: [4, 5, 6, 7], 3: [5, 6, 7] };
    const state = playedRound(start(), roundIndex(), absent);
    const result = fairCutAdvancement(state, roundIndex());
    expect(result.advancing).toHaveLength(53 - 11);
    expect(result.advancing.length).toBeLessThan(43 + 1);
    expect(result.eliminated).toHaveLength(11);
    expect(new Set(result.eliminated)).toEqual(
      new Set([...names(1, [4, 5, 6, 7]), ...names(2, [4, 5, 6, 7]), ...names(3, [5, 6, 7])]),
    );
  });

  it('is unchanged by the version when nobody is absent', () => {
    const state = playedRound(start(), roundIndex(), {});
    expect(fairCutAdvancement(state, roundIndex()).advancing).toHaveLength(43);
  });
});

describe('31 1v1, single elimination', () => {
  const setup = {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'none',
  } as const;

  it('a walkover for the opponent of an absentee, and a lucky loser keeps the count when both are absent', () => {
    const start = generate('1v1 31', 31, setup);
    const roundIndex = firstEliminationIndex(start);
    const round = start.rounds[roundIndex];
    expect(round.byeCount).toBe(1);
    // Room 1: seat 2 absent (the other walks over). Room 2: both absent.
    const state = playedRound(start, roundIndex, { 1: [1], 2: [0, 1] });
    const result = fairCutAdvancement(state, roundIndex);
    expect(result.advancing.map((entry) => entry.name)).toContain('R1P1');
    expect(result.advancing.map((entry) => entry.name)).not.toContain('R1P2');
    expect(result.eliminated).toEqual(expect.arrayContaining(['R1P2', 'R2P1', 'R2P2']));
    // The round still sends on what it planned (its bye is carried apart from the rooms).
    expect(result.advancing).toHaveLength(round.advTotal - round.byeCount);
    expect(result.luckyNames).toHaveLength(1);
  });
});

describe('a double elimination (shared Final)', () => {
  it('drops an absentee of a winners round to the losers bracket', () => {
    const start = generate('DE 37', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
    });
    const roundIndex = start.rounds.findIndex((round) => round.bracket === 'winners' && !round.isNoElim);
    const state = playedRound(start, roundIndex, { 1: [6, 7] });
    const result = doubleEliminationComputeAdvancement(state, roundIndex);
    const losers = result.losers.map((entry) => entry.name);
    expect(losers).toEqual(expect.arrayContaining(['R1P7', 'R1P8']));
    expect(result.winners.map((entry) => entry.name)).not.toContain('R1P7');
  });
});

describe("Kings Valley: an absentee moves down as the room's last place", () => {
  it('ranks an absentee below a present unit that also scored 0', () => {
    const start = generate('KV 37', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'kings-valley',
      poolingPhase: 'none',
    });
    const roundIndex = start.rounds.findIndex((round) => round.isKingsValley);
    const lastRoom = start.rounds[roundIndex].rooms.length;
    const size = start.rounds[roundIndex].rooms[lastRoom - 1];
    // The last two seats scored 0: the earlier of them was absent, the later one played.
    let state = playedRound(start, roundIndex, { [lastRoom]: [size - 2] });
    state = answerAbsence(
      { ...state, scores: { ...state.scores, [`r${roundIndex}-rm${lastRoom}-p${size - 1}`]: 0 } },
      [`r${roundIndex}-rm${lastRoom}-p${size - 1}`],
      'played',
    );
    const order = roomFinishOrder(state, roundIndex, lastRoom);
    expect(order.at(-1)).toBe(`R${lastRoom}P${size - 1}`);
    expect(order.at(-2)).toBe(`R${lastRoom}P${size}`);
    const { eliminatedNames } = kingsValleyComputeAdvancement(state, roundIndex);
    expect(eliminatedNames).toContain(`R${lastRoom}P${size - 1}`);
  });
});

describe('a custom bracket (waterfall) room of 8 with a top-4 band', () => {
  const build = (): TournamentState => {
    const players = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);
    const scores = { 'r0-rm1-p0': 90, 'r0-rm1-p1': 70, 'r0-rm1-p2': 50 };
    const state = createDefaultTournamentState({
      players,
      gamemodeConfig: { absenceVersion: 1 },
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [8],
          players: 8,
          isWaterfall: true,
          waterfallRoutes: [[1, 1, 1, 1, 'eliminated', 'eliminated', 'eliminated', 'eliminated']],
        }),
        buildRound({ roundNum: 2, rooms: [4], players: 4 }),
      ],
      assignments: [buildAssignments(players, [8])],
      scores: { ...scores, ...Object.fromEntries([3, 4, 5, 6, 7].map((p) => [`r0-rm1-p${p}`, 0])) },
      started: true,
    });
    return answerAbsence(
      state,
      [3, 4, 5, 6, 7].map((p) => `r0-rm1-p${p}`),
      'absent',
    );
  };

  it('ranks the absentees after every present unit, with no share', () => {
    const state = build();
    const tiers = buildAdvancementTiers(
      state,
      0,
      state.assignments[0].map((entry) => entry.name),
    );
    expect(tiers.map((tier) => tier.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(tiers.slice(0, 3).map((tier) => tier.members[0].name)).toEqual(['W1', 'W2', 'W3']);
    const absentees = tiers.slice(3);
    expect(absentees.map((tier) => tier.members[0].name)).toEqual(['W4', 'W5', 'W6', 'W7', 'W8']);
    for (const tier of absentees) expect(tier.members[0]).toMatchObject({ pct: 0, sourceRoom: 1 });
  });

  it('routes the first absentee with the top band: the 3 present take ranks 1–3 and it takes rank 4', () => {
    const state = build();
    const routed = routeWaterfallRound(state, 0, state.rounds[0]);
    expect([...routed.keys()]).toEqual([1]);
    expect(routed.get(1)?.map((seed) => seed.name)).toEqual(['W1', 'W2', 'W3', 'W4']);
  });
});

describe('hasPlayedAnyMatch, through the withdrawal a removal records', () => {
  const twoRooms = (): TournamentState =>
    createDefaultTournamentState({
      players: ['A', 'B', 'C', 'D'],
      gamemodeConfig: { absenceVersion: 1 },
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], players: 4 }),
        buildRound({ roundNum: 2, rooms: [4], players: 4 }),
      ],
      assignments: [buildAssignments(['A', 'B', 'C', 'D'], [4]), buildAssignments(['A', 'B', 'C', 'D'], [4])],
      scores: { 'r0-rm1-p0': 80, 'r0-rm1-p1': 60, 'r0-rm1-p2': 40, 'r0-rm1-p3': 0 },
      started: true,
    });

  it('a unit absent in its only scored round lands in the absent list, not the DNF list', () => {
    const state = answerAbsence(twoRooms(), ['r0-rm1-p3'], 'absent');
    const removed = removeRosterUnit(state, 'D');
    expect(removed.withdrawnUnits).toMatchObject([{ name: 'D', playedAnyMatch: false }]);
  });

  it('a unit that played is a DNF, and so is one whose 0 was answered "played"', () => {
    const state = answerAbsence(twoRooms(), ['r0-rm1-p3'], 'played');
    expect(removeRosterUnit(state, 'A').withdrawnUnits).toMatchObject([{ name: 'A', playedAnyMatch: true }]);
    expect(removeRosterUnit(state, 'D').withdrawnUnits).toMatchObject([{ name: 'D', playedAnyMatch: true }]);
  });
});
