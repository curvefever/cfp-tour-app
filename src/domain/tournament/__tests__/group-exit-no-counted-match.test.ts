import { describe, expect, it } from 'vitest';
import { computeGroupStandings, getAllTies, hasPendingTies, selectGroupExit } from '../advancement';
import { removeRosterUnit } from '../mutations';
import { scoreKeysForPosition } from '../scoring';
import { describeStandings } from '../standings-display';
import { advanceTournamentRound } from '../transitions';
import type { TournamentStanding, TournamentState } from '../types';
import { buildState } from './play-through';

/** A one-versus-one group stage of `count` players: a fair cut of `total` (or an even one) out of the groups. */
function groupStage(
  count: number,
  size: number,
  total: number,
  setup: Record<string, string> = {},
): TournamentState {
  const state = buildState({
    label: `no-counted-${count}`,
    count,
    teams: false,
    setup: {
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      scheduleLogic: 'single-elimination',
      groupSize: String(size),
      groupExit: 'fair-cut',
      qualAdv: String(total),
      oddCountStrategy: 'bye',
      ...setup,
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

const groupRounds = (state: TournamentState) => state.rounds.filter((round) => round.isGroupStage).length;

interface Play {
  /** Whether the unit seated in this room position did not turn up. */
  absent?: (state: TournamentState, roundIndex: number, room: number, position: number) => boolean;
  /** The score of a seat in each game: the first-listed unit wins 300 to 100 by default. */
  score?: (position: number) => number;
}

/** Scores every group round up to and including `through`, leaving that round in play. */
function playGroupRounds(start: TournamentState, through: number, play: Play = {}): TournamentState {
  let state = start;
  for (let roundIndex = 0; roundIndex <= through; roundIndex += 1) {
    const round = state.rounds[state.curRound];
    const scores = { ...state.scores };
    const absences = { ...state.absences };
    const seen = new Map<number, number>();
    for (const entry of state.assignments[state.curRound] ?? []) {
      if (entry.room === null) continue;
      const position = seen.get(entry.room) ?? 0;
      seen.set(entry.room, position + 1);
      const away = play.absent?.(state, state.curRound, entry.room, position) ?? false;
      const keys = scoreKeysForPosition({
        roundIndex: state.curRound,
        room: entry.room,
        position,
        numGames: round.bestOf ?? round.numGames ?? 1,
      });
      for (const key of keys) {
        scores[key] = away ? 0 : (play.score?.(position) ?? (position === 0 ? 300 : 100));
        if (away) absences[key] = 'absent';
      }
    }
    state = { ...state, scores, absences };
    if (roundIndex === through) break;
    const advanced = advanceTournamentRound(state);
    if (advanced.status !== 'advanced') throw new Error(`blocked at round ${roundIndex}: ${advanced.status}`);
    state = advanced.state;
  }
  return state;
}

const lineOf = (state: TournamentState, group: string, name: string): TournamentStanding => {
  const line = computeGroupStandings(state)[group].find((entry) => entry.name === name);
  if (!line) throw new Error(`no line for ${name}`);
  return line;
};

const advancingOf = (state: TournamentState) =>
  selectGroupExit(state, computeGroupStandings(state)).advancing;

/** The first unit of group A, and the first group round it plays a match in (a group of 3 has one bye each). */
function firstUnitOfA(state: TournamentState) {
  const name = state.groups[0].members[0];
  const firstPlayed = state.rounds.findIndex((round) =>
    round.matches?.some((match) => match.pair.includes(name)),
  );
  return { name, firstPlayed };
}

/** Both opponents of `name` stay away from their match against it. */
const awayFrom =
  (name: string): NonNullable<Play['absent']> =>
  (state, roundIndex, room, position) => {
    const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
    return (
      seated.length === 2 && seated.some((entry) => entry.name === name) && seated[position].name !== name
    );
  };

const SETUPS: Array<[string, Record<string, string>, number]> = [
  ['Standard points', {}, 2],
  ['Standard points, a round of 2 games', { poolingGames: '2' }, 2],
  ['Match results', { scoring: 'match-results', tieMargin: '100' }, 3],
  ['Match results, a round of 2 games', { scoring: 'match-results', tieMargin: '100', poolingGames: '2' }, 6],
  ['Match results, a Best of 3', { scoring: 'match-results', tieMargin: '100', poolingBestOf: '3' }, 3],
];

describe('a team whose opponents were both absent, 9 teams in groups of 3, fair cut 6', () => {
  describe.each(SETUPS)('%s', (_label, setup, winPoints) => {
    const start = groupStage(9, 3, 6, setup);
    const lastRound = groupRounds(start) - 1;
    const { name } = firstUnitOfA(start);
    const state = playGroupRounds(start, lastRound, { absent: awayFrom(name) });

    it('takes a win for each match, worth what a played clean win is worth', () => {
      const line = lineOf(state, 'A', name);
      expect(line.rounds).toHaveLength(2);
      expect(line.rounds?.every((round) => round.walkover === true && round.score === null)).toBe(true);
      expect(line).toMatchObject({ totalFP: winPoints * 2, matches: 2, averagePoints: winPoints });
      expect(line.roomShare).toBeNull();
      const played = computeGroupStandings(state).B[0].rounds?.find((round) => round.rank === 1);
      expect(played?.points).toBe(winPoints);
    });

    it('ranks first in its group and goes through, ahead of the teams that stayed away', () => {
      const table = computeGroupStandings(state).A;
      expect(table[0].name).toBe(name);
      expect(advancingOf(state)).toContain(name);
      expect(advancingOf(state)).toHaveLength(6);
    });
  });

  it('reads the win in the standings cell, not as a void match', () => {
    const start = groupStage(9, 3, 6);
    const { name } = firstUnitOfA(start);
    const state = playGroupRounds(start, groupRounds(start) - 1, { absent: awayFrom(name) });
    const entry = describeStandings(state)?.tables[0].entries.find((candidate) => candidate.name === name);
    expect(entry?.voidRounds).toBeUndefined();
    expect(entry?.rounds?.map((round) => round.walkover)).toEqual([true, true]);
  });
});

describe('a team with one counted match', () => {
  const start = groupStage(9, 3, 6);
  const { name, firstPlayed } = firstUnitOfA(start);
  const firstOpponentAway: NonNullable<Play['absent']> = (state, roundIndex, room, position) =>
    roundIndex === firstPlayed && awayFrom(name)(state, roundIndex, room, position);
  const state = playGroupRounds(start, groupRounds(start) - 1, { absent: firstOpponentAway });

  it('keeps the match its opponent stayed away from void: no win', () => {
    const line = lineOf(state, 'A', name);
    expect(line.rounds?.map((round) => round.walkover)).toEqual([undefined]);
    expect(line).toMatchObject({ matches: 1 });
    const entry = describeStandings(state)?.tables[0].entries.find((candidate) => candidate.name === name);
    expect(entry?.voidRounds).toEqual([firstPlayed]);
  });
});

describe('a team whose opponents were removed, not absent', () => {
  const start = groupStage(9, 3, 6);
  const [first, second, third] = start.groups[0].members;
  const state = playGroupRounds(removeRosterUnit(removeRosterUnit(start, second), third), 2);

  it('gets no win, but stays in its group, last, and goes through as the group of one', () => {
    expect(lineOf(state, 'A', first)).toMatchObject({ totalFP: null });
    expect(computeGroupStandings(state).A.map((entry) => entry.name)).toContain(first);
    expect(advancingOf(state)).toContain(first);
  });
});

describe('a group reduced to one unit by removals, 12 teams in groups of 4, fair cut 10', () => {
  const start = groupStage(12, 4, 10);
  const [kept, ...gone] = start.groups[0].members;
  const state = playGroupRounds(gone.reduce(removeRosterUnit, start), groupRounds(start) - 1);

  it('sends its unit with the other groups', () => {
    expect(advancingOf(state)).toContain(kept);
    expect(advancingOf(state)).toHaveLength(9);
    expect(advancingOf(state).filter((unit) => gone.includes(unit))).toEqual([]);
  });
});

describe('a group stage that has no result yet', () => {
  it('draws no cut-off tie and moves no cut line, 13 teams in groups of 5, 4, 4, fair cut 8', () => {
    const state = groupStage(13, 4, 8);
    expect(hasPendingTies(state, 0)).toBe(false);
    expect(getAllTies(state, 0)).toEqual({});
    expect(describeStandings(state)?.tables.map((table) => table.cut)).toEqual([3, 2, 2]);
    expect(selectGroupExit(state, computeGroupStandings(state)).advancing).toEqual([]);
  });
});

describe.each([31, 37])(
  '%i teams in groups of 4, fair cut 16, one team never played a counted match',
  (count) => {
    const start = groupStage(count, 4, 16);
    const lastRound = groupRounds(start) - 1;
    const { name } = firstUnitOfA(start);
    const state = playGroupRounds(start, lastRound, { absent: awayFrom(name) });

    it('counts its wins and lets it through when it tops its group', () => {
      const line = lineOf(state, 'A', name);
      expect(line.rounds?.every((round) => round.walkover === true)).toBe(true);
      expect(advancingOf(state)).toContain(name);
      expect(advancingOf(state)).toHaveLength(16);
    });
  },
);
