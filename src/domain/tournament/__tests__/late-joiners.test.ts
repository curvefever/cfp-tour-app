import { describe, expect, it } from 'vitest';
import { buildAdvancementTiers, computeQualificationStandings } from '../advancement';
import { generateTournament } from '../generation';
import { lateJoinersOf } from '../late-joiners';
import {
  addReserveUnit,
  addWalkUpIndividual,
  missedCountedRounds,
  type ReserveAddResult,
} from '../mutations';
import { distributeRooms } from '../room-distribution';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { scoreCurrentRound } from './play-through';
import { buildQualWaterfall } from './qual-waterfall';
import { fixedIdSource } from './test-fixtures';

type Setup = Parameters<typeof createDefaultSetup>[0];

function build(count: number, setup: Setup, teams = false): TournamentState {
  const players = teams
    ? Array.from({ length: count }, (_, index): TournamentTeam => ({
        teamId: `t${index + 1}`,
        teamName: `Team ${index + 1}`,
        members: [{ name: `a${index}` }, { name: `b${index}` }],
      }))
    : Array.from({ length: count }, (_, index) => `P${index + 1}`);
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players }),
    createDefaultSetup(setup),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return { ...result.state, started: true };
}

/** Scores the round in play and advances it. */
function playRound(state: TournamentState, teamSize = 0): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, teamSize));
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${JSON.stringify(result)}`);
  return result.state;
}

function playRounds(state: TournamentState, count: number): TournamentState {
  return Array.from({ length: count }).reduce<TournamentState>((current) => playRound(current), state);
}

function added(result: ReserveAddResult): TournamentState {
  if (result.status !== 'added') throw new Error(`expected an add, got ${JSON.stringify(result)}`);
  return result.state;
}

/** A walk-up added past the late-join confirm, as the organiser would after accepting it. */
const join = (state: TournamentState, name = 'Late') =>
  added(addWalkUpIndividual(state, name, { allowLateJoin: true }));

const seated = (state: TournamentState, index: number, name: string) =>
  (state.assignments[index] ?? []).filter((entry) => entry.name === name).length;
const seatedCount = (state: TournamentState, index: number) =>
  (state.assignments[index] ?? []).filter((entry) => entry.room !== null).length;
const roomSizeOf = (state: TournamentState) =>
  state.gamemodeConfig.roomSize as { min: number; max: number; ideal: number };

/** The joiner leaves the round in play untouched. */
function expectRoundInPlayUnchanged(before: TournamentState, after: TournamentState) {
  expect(after.assignments).toEqual(before.assignments);
  expect(after.curRound).toBe(before.curRound);
}

const FFA_QUAL = { poolingPhase: 'qual-table', qualAdv: '16' } as const;

describe('a late joiner in a pooling round: FFA qualification table at 37, advance 16', () => {
  it('added at round 1 with no prompt; round 2 is drawn for 38 with the joiner seated once', () => {
    const start = build(37, FFA_QUAL);
    const joined = added(addWalkUpIndividual(start, 'Late'));
    expect(joined.players).toHaveLength(38);
    expectRoundInPlayUnchanged(start, joined);

    const next = playRound(joined);
    expect(next.curRound).toBe(1);
    expect(seated(next, 1, 'Late')).toBe(1);
    expect(seatedCount(next, 1)).toBe(38);
    expect(next.rounds[1].rooms).toEqual(distributeRooms(38, roomSizeOf(next)));
  });

  it('asks at round 2: 2 missed rounds, and adds once the organiser accepts', () => {
    const atRound2 = playRound(build(37, FFA_QUAL));
    expect(addWalkUpIndividual(atRound2, 'Late')).toEqual({ status: 'confirm-late-join', missedRounds: 2 });

    const joined = join(atRound2);
    expectRoundInPlayUnchanged(atRound2, joined);
    const next = playRound(joined);
    expect(seated(next, 2, 'Late')).toBe(1);
    expect(seatedCount(next, 2)).toBe(38);
    expect(next.rounds[2].rooms).toEqual(distributeRooms(38, roomSizeOf(next)));
  });

  it('added in the last qualifying round (3 missed): ranked below everyone with points, cut, bracket unchanged', () => {
    const atRound3 = playRounds(build(37, FFA_QUAL), 2);
    expect(addWalkUpIndividual(atRound3, 'Late')).toEqual({ status: 'confirm-late-join', missedRounds: 3 });

    const joined = join(atRound3);
    expectRoundInPlayUnchanged(atRound3, joined);
    expect(joined.rounds.slice(3)).toEqual(atRound3.rounds.slice(3));

    const next = playRound(joined);
    expect(next.curRound).toBe(3);
    expect(seated(next, 3, 'Late')).toBe(0);
    expect(seatedCount(next, 3)).toBe(16);
    const ranked = next.qualTable.map((entry) => entry.name);
    expect(ranked).toHaveLength(38);
    expect(ranked.at(-1)).toBe('Late');
  });

  it('counts the rounds missed so far, the one in play included', () => {
    const start = build(37, FFA_QUAL);
    expect(missedCountedRounds(start)).toBe(1);
    expect(missedCountedRounds(playRound(start))).toBe(2);
  });
});

describe('a late joiner when the first qualifying round does not count (43, advance 16)', () => {
  const setup = { ...FFA_QUAL, nonCountingRounds: '1' } as const;

  it('added at round 2 misses 1 counted round: no prompt', () => {
    const atRound2 = playRound(build(43, setup));
    expect(missedCountedRounds(atRound2)).toBe(1);
    const joined = added(addWalkUpIndividual(atRound2, 'Late'));
    const next = playRound(joined);
    expect(seated(next, 2, 'Late')).toBe(1);
    expect(seatedCount(next, 2)).toBe(44);
  });

  it('added at round 3 misses 2 counted rounds: asks', () => {
    const atRound3 = playRounds(build(43, setup), 2);
    expect(addWalkUpIndividual(atRound3, 'Late')).toEqual({ status: 'confirm-late-join', missedRounds: 2 });
  });
});

describe('a late joiner in Swiss, 1v1 with byes', () => {
  const setup = {
    gameFormat: 'individual-1v1',
    poolingPhase: 'swiss',
    qualAdv: '16',
    oddCountStrategy: 'bye',
  } as const;

  it('31 registered: added at round 2, round 3 is 16 rooms with no bye', () => {
    const atRound2 = playRound(build(31, setup));
    const joined = join(atRound2);
    expectRoundInPlayUnchanged(atRound2, joined);
    const next = playRound(joined);
    expect(next.rounds[2].rooms).toHaveLength(16);
    expect(next.byes[2] ?? []).toEqual([]);
    expect(seated(next, 2, 'Late')).toBe(1);
    expect(seatedCount(next, 2)).toBe(32);
  });

  it('53 registered: added at round 2, round 3 is 27 rooms with no bye (54 pair evenly)', () => {
    const next = playRound(join(playRound(build(53, setup))));
    expect(next.rounds[2].rooms).toHaveLength(27);
    expect(next.byes[2] ?? []).toEqual([]);
    expect(seated(next, 2, 'Late')).toBe(1);
  });

  it('52 registered: the joiner makes 53, so round 3 is 26 rooms and 1 bye, the joiner placed once', () => {
    const next = playRound(join(playRound(build(52, setup))));
    expect(next.rounds[2].rooms).toHaveLength(26);
    expect(next.byes[2]).toHaveLength(1);
    expect(seated(next, 2, 'Late')).toBe(1);
  });
});

describe('a late joiner in a waterfall with a Qual source', () => {
  const firstWaterfall = (state: TournamentState) => state.rounds.findIndex((round) => round.isWaterfall);

  function scoreToQualExit(state: TournamentState): TournamentState {
    let current = state;
    while (current.rounds[current.curRound + 1]?.isQual) current = playRound(current);
    return scoreCurrentRound(current, 0);
  }

  it.each([
    [37, 14],
    [53, 30],
  ])(
    '%i registered: a joiner at qualification round 2 leaves the rounds alone; %i are eliminated at the exit',
    (registered, eliminated) => {
      const start = playRound(buildQualWaterfall(registered));
      const joined = join(start);
      expectRoundInPlayUnchanged(start, joined);
      expect(joined.rounds.slice(firstWaterfall(start))).toEqual(start.rounds.slice(firstWaterfall(start)));

      const exit = scoreToQualExit(joined);
      expect(seated(exit, exit.curRound, 'Late')).toBe(1);
      const result = advanceTournamentRound(exit);
      expect(result.status).toBe('advanced');
      if (result.status !== 'advanced') return;
      const next = result.state;
      const placed = new Set([
        ...next.assignments[next.curRound].map((entry) => entry.name),
        ...Object.values(next.pendingBracketSeeds).flatMap((seeds) => seeds.map((seed) => seed.name)),
      ]);
      expect(placed.size).toBe(24);
      expect(next.players.length - placed.size).toBe(eliminated);
    },
  );

  it('keeps a graph edited after generation: the joiner does not re-plan the waterfall rounds', () => {
    const start = playRound(buildQualWaterfall(37));
    const edited = {
      ...start,
      rounds: start.rounds.map((round) =>
        round.isWaterfall ? { ...round, customLabel: `${round.customLabel}-edited` } : round,
      ),
    };
    const joined = join(edited);
    expect(joined.rounds.slice(firstWaterfall(start))).toEqual(edited.rounds.slice(firstWaterfall(start)));
    expect(joined.rounds[firstWaterfall(start)].customLabel).toMatch(/-edited$/);
  });

  it('without a pooling phase a waterfall still refuses a joiner', () => {
    const graph = `
ROUNDS:
R1 = 2x8
R2 = 8
Final = 6 FINAL

ROUTES:
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R2: 1-6->Final, 7-8->eliminated
`;
    const start = buildQualWaterfall(16, graph, { poolingPhase: 'none' });
    expect(addWalkUpIndividual(start, 'Late')).toEqual({ status: 'blocked', reason: 'waterfall-bracket' });
  });
});

describe('a late joiner in double elimination, 1v1', () => {
  it('qualification table at 43: added in the last qualifying round after the confirm, bracket rounds unchanged', () => {
    const setup = {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '16',
      oddCountStrategy: 'bye',
    } as const;
    const atRound3 = playRounds(build(43, setup), 2);
    expect(addWalkUpIndividual(atRound3, 'Late')).toEqual({ status: 'confirm-late-join', missedRounds: 3 });
    const joined = join(atRound3);
    expect(joined.rounds.slice(3)).toEqual(atRound3.rounds.slice(3));
    const next = playRound(joined);
    expect(seated(next, 3, 'Late')).toBe(0);
  });

  describe('without a pooling phase, 31 players and 2 warm-ups', () => {
    const setup = {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
      nonCountingRounds: '2',
      oddCountStrategy: 'bye',
    } as const;

    it('a joiner in warm-up 2 is not seated there; the bracket is rebuilt for 32 and draws them in', () => {
      const atWarmUp2 = playRound(build(31, setup));
      const joined = added(addWalkUpIndividual(atWarmUp2, 'Late'));
      expectRoundInPlayUnchanged(atWarmUp2, joined);
      expect(joined.rounds.slice(2)).toEqual(build(32, setup).rounds.slice(2));

      const next = playRound(joined);
      expect(seated(next, 2, 'Late')).toBe(1);
      expect(next.byes[2] ?? []).toEqual([]);
      expect(seatedCount(next, 2)).toBe(32);
    });

    it('a joiner in the first bracket round is seated in it, asking first when every room is full', () => {
      const inBracket = playRounds(build(31, setup), 2);
      expect(addWalkUpIndividual(inBracket, 'Late').status).toBe('confirm-over-cap');
      const joined = added(addWalkUpIndividual(inBracket, 'Late', { allowOverCap: true }));
      expect(seated(joined, inBracket.curRound, 'Late')).toBe(1);
    });
  });
});

describe('a late joiner in a tournament without a pooling phase', () => {
  it('single elimination FFA at 37: seated in the first bracket round, least-full room; closed from the second', () => {
    const setup = { poolingPhase: 'none', nonCountingRounds: '2' } as const;
    const inBracket = playRounds(build(37, setup), 2);
    const joined = added(addWalkUpIndividual(inBracket, 'Late'));
    const entry = joined.assignments[inBracket.curRound].find((seat) => seat.name === 'Late');
    expect(entry?.room).toBe(3);

    const second = playRound(joined);
    expect(second.reserveOpen).toBe(false);
    expect(addWalkUpIndividual(second, 'Other')).toEqual({ status: 'blocked', reason: 'closed' });
  });

  it('Kings Valley FFA at 53: a joiner in warm-up 2 makes the first Kings Valley round 54 strong', () => {
    const setup = { scheduleLogic: 'kings-valley', poolingPhase: 'none', nonCountingRounds: '2' } as const;
    const joined = added(addWalkUpIndividual(playRound(build(53, setup)), 'Late'));
    const next = playRound(joined);
    expect(seated(next, 2, 'Late')).toBe(1);
    expect(seatedCount(next, 2)).toBe(54);
    expect(next.rounds[2].rooms.reduce((sum, size) => sum + size, 0)).toBe(54);
  });
});

describe('a late joiner team in 2v2v2v2, qualification table at 31 teams', () => {
  it('a reserve team added at round 1 joins round 2', () => {
    const start = build(31, { gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table', qualAdv: '8' }, true);
    const reserve: TournamentTeam = {
      teamId: 'late',
      teamName: 'Late Team',
      members: [{ name: 'x1' }, { name: 'x2' }],
    };
    const joined = added(addReserveUnit({ ...start, reserves: [reserve] }, 'late'));
    expect(joined.players).toHaveLength(32);
    expect(joined.reserves).toEqual([]);
    expectRoundInPlayUnchanged(start, joined);

    const next = playRound(joined, 2);
    expect(seated(next, 1, 'late')).toBe(1);
    expect(seatedCount(next, 1)).toBe(32);
  });
});

describe('what stays blocked', () => {
  it('group stage 1v1 at 37', () => {
    const start = build(37, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      oddCountStrategy: 'bye',
    });
    expect(addWalkUpIndividual(start, 'Late')).toEqual({ status: 'blocked', reason: 'group-stage' });
  });

  it('a fixed draw', () => {
    const start = build(37, { ...FFA_QUAL, drawPublication: 'fixed' });
    expect(addWalkUpIndividual(start, 'Late')).toEqual({ status: 'blocked', reason: 'fixed-draw' });
  });

  it('the strict odd-count strategy "None": 32 players, one more would leave a unit out of every pairing', () => {
    const start = build(32, {
      gameFormat: 'individual-1v1',
      poolingPhase: 'qual-table',
      qualAdv: '16',
      oddCountStrategy: 'none',
    });
    expect(addWalkUpIndividual(start, 'Late')).toEqual({ status: 'blocked', reason: 'strict-room' });
  });
});

describe('a late joiner is seeded as an average unit, and never given a bye, in their first round', () => {
  const tierOf = (state: TournamentState, roundIndex: number, name: string) => {
    const names = (state.players as string[]).slice();
    for (const tier of buildAdvancementTiers(state, roundIndex, names)) {
      const member = tier.members.find((entry) => entry.name === name);
      if (member) return { rank: tier.rank, pct: member.pct, sourceRoom: member.sourceRoom };
    }
    throw new Error(`${name} is in no tier`);
  };
  const joinAndScore = (state: TournamentState, names: string[]) => {
    const joined = names.reduce((current, name) => join(current, name), state);
    return scoreCurrentRound(joined, 0);
  };

  it('lateJoinersOf lists the roster units neither seated nor on a bye, in add order; nobody for a later round', () => {
    const start = build(37, FFA_QUAL);
    const joined = join(join(start, 'Late1'), 'Late2');
    expect(lateJoinersOf(joined, 0)).toEqual(['Late1', 'Late2']);
    expect(lateJoinersOf(playRound(joined), 0)).toEqual(['Late1', 'Late2']);
    expect(lateJoinersOf(playRound(joined), 1)).toEqual([]);
  });

  it('FFA qual table at 37 (rooms [8,8,7,7,7]): the joiner is in tier 4 with share 5/37, not tier 0', () => {
    const state = joinAndScore(build(37, FFA_QUAL), ['Late']);
    expect(state.rounds[0].rooms).toEqual([8, 8, 7, 7, 7]);
    expect(tierOf(state, 0, 'Late')).toEqual({ rank: 4, pct: 5 / 37, sourceRoom: 0 });
  });

  it.each([
    [43, 1],
    [53, 2],
  ])(
    'at %i registered the %i joiner(s) sit in tier floor(largest room / 2), in add order',
    (registered, joiners) => {
      const names = ['Late1', 'Late2'].slice(0, joiners);
      const state = joinAndScore(build(registered, FFA_QUAL), names);
      const largest = Math.max(...state.rounds[0].rooms);
      const tiers = buildAdvancementTiers(state, 0, state.players as string[]);
      const tier = tiers.find((entry) => entry.rank === Math.floor(largest / 2));
      const inTier = (tier?.members ?? [])
        .filter((member) => member.sourceRoom === 0)
        .map((member) => member.name);
      expect(inTier).toEqual(names);
      for (const name of names) expect(tierOf(state, 0, name).rank).toBe(Math.floor(largest / 2));
    },
  );

  it('FFA qual table at 19 (rooms [7,6,6]): the joiner is in tier 3, the 4th place of the largest room, with share 3/19', () => {
    const state = joinAndScore(build(19, FFA_QUAL), ['Late']);
    expect(state.rounds[0].rooms).toEqual([7, 6, 6]);
    expect(tierOf(state, 0, 'Late')).toEqual({ rank: 3, pct: 3 / 19, sourceRoom: 0 });
  });

  describe('head-to-head qualification table at 37, byes', () => {
    const setup = {
      gameFormat: 'individual-1v1',
      poolingPhase: 'qual-table',
      qualAdv: '16',
      oddCountStrategy: 'bye',
    } as const;

    it('a bye unit keeps tier 0 with share 1; the joiner goes to the losers tier with share 1/2', () => {
      const start = build(37, setup);
      const bye = start.byes[0][0];
      const state = joinAndScore(start, ['Late']);
      expect(tierOf(state, 0, bye)).toEqual({ rank: 0, pct: 1, sourceRoom: 0 });
      expect(tierOf(state, 0, 'Late')).toEqual({ rank: 1, pct: 18 / 36, sourceRoom: 0 });
    });

    it('36 registered plus a joiner is 37: the bye goes to a regular unit, never the joiner, even when only the joiner has had none', () => {
      const start = build(36, setup);
      const joined = join(start);
      const everyoneElseHadOne = Object.fromEntries((start.players as string[]).map((name) => [name, 1]));
      const withCounts = { ...joined, poolingByeCounts: everyoneElseHadOne };
      const next = playRound(withCounts);
      expect(next.byes[1]).toHaveLength(1);
      expect(next.byes[1]).not.toContain('Late');
      expect(seated(next, 1, 'Late')).toBe(1);
    });
  });

  describe('Swiss 1v1', () => {
    const setup = {
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      qualAdv: '16',
      oddCountStrategy: 'bye',
    } as const;

    const rankedWithout = (state: TournamentState, joiners: string[]) =>
      computeQualificationStandings(state)
        .map((entry) => entry.name)
        .filter((name) => !joiners.includes(name));
    const opponentOf = (state: TournamentState, roundIndex: number, name: string) => {
      const room = state.assignments[roundIndex].find((entry) => entry.name === name)?.room;
      return state.assignments[roundIndex].find((entry) => entry.room === room && entry.name !== name)?.name;
    };

    it('31 registered: the joiner goes last in the fold, so they meet the middle-ranked unit (fold index half - 1), and there is no bye', () => {
      const joined = join(playRound(build(31, setup)));
      const ranked = rankedWithout(scoreCurrentRound(joined, 0), ['Late']);
      const next = playRound(joined);
      expect(next.byes[2] ?? []).toEqual([]);
      expect(opponentOf(next, 2, 'Late')).toBe(ranked[15]);
    });

    it('30 registered and two joiners: they meet the units at fold index half - 2 and half - 1, in add order', () => {
      const joined = join(join(playRound(build(30, setup)), 'Late1'), 'Late2');
      const ranked = rankedWithout(scoreCurrentRound(joined, 0), ['Late1', 'Late2']);
      const next = playRound(joined);
      expect(next.byes[2] ?? []).toEqual([]);
      expect(opponentOf(next, 2, 'Late1')).toBe(ranked[14]);
      expect(opponentOf(next, 2, 'Late2')).toBe(ranked[15]);
    });

    it('30 registered plus a joiner is 31: the bye goes to a regular unit', () => {
      const next = playRound(join(playRound(build(30, setup))));
      expect(next.byes[2]).toHaveLength(1);
      expect(next.byes[2]).not.toContain('Late');
      expect(seated(next, 2, 'Late')).toBe(1);
    });

    it('30 registered, everyone else already had a bye: the old rule (fewest byes) would pick the joiner, the bye still goes to a regular unit', () => {
      const atRound2 = playRound(build(30, setup));
      const joined = join(atRound2);
      const everyoneElseHadOne = Object.fromEntries((atRound2.players as string[]).map((name) => [name, 1]));
      const next = playRound({ ...joined, poolingByeCounts: everyoneElseHadOne });
      expect(next.byes[2]).toHaveLength(1);
      expect(next.byes[2]).not.toContain('Late');
      expect(next.poolingByeCounts.Late ?? 0).toBe(0);
    });
  });

  it('warm-ups into the first bracket round (single elimination FFA, 31): a joiner in warm-up 2 is in the middle tier', () => {
    const setup = { poolingPhase: 'none', nonCountingRounds: '2' } as const;
    const atWarmUp2 = playRound(build(31, setup));
    const state = joinAndScore(atWarmUp2, ['Late']);
    const largest = Math.max(...state.rounds[1].rooms);
    expect(tierOf(state, 1, 'Late').rank).toBe(Math.floor(largest / 2));
    expect(tierOf(state, 1, 'Late').sourceRoom).toBe(0);
    const next = playRound(join(atWarmUp2));
    expect(seated(next, 2, 'Late')).toBe(1);
  });

  it("from the joiner's second round on, their own result seeds them: their real room place", () => {
    const joined = playRound(join(build(37, FFA_QUAL)));
    const scored = scoreCurrentRound(joined, 0);
    const entries = scored.assignments[1];
    const room = entries.find((entry) => entry.name === 'Late')?.room as number;
    const place = entries.filter((entry) => entry.room === room).findIndex((entry) => entry.name === 'Late');
    expect(tierOf(scored, 1, 'Late')).toMatchObject({ rank: place, sourceRoom: room });
  });
});
