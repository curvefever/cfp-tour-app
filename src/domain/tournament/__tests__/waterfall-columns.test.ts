import { describe, expect, it } from 'vitest';
import { getAllColumnTies, hasPendingColumnTies } from '../advancement';
import { generateTournament } from '../generation';
import { removeRosterUnit, resolveTournamentTie, setTeamDefender, swapIndividual } from '../mutations';
import { computeRankings } from '../rankings';
import { drawnAheadStatus } from '../redraw';
import { createTournamentRuntime } from '../runtime';
import { currentColumn, roundInPlayOf } from '../round-columns';
import { getDefenderIndex, scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { scoreCurrentRound } from './play-through';
import {
  ALL_ROUTED_GRAPHS,
  QUAL_GRAPH,
  buildQualWaterfall,
  playToQualificationExit,
  withoutColumns,
} from './qual-waterfall';
import { fixedIdSource } from './test-fixtures';

const LIVE_GRAPH = `
ROUNDS:
Round 5 Upper = 2x4
Round 5 Lower = 2x4
Semi A = 4
Round 6 = 2x4
Round 7 = 4
Semi-B = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->Round 5 Upper, 9-16->Round 5 Lower
Round 5 Upper.A: 1-2->Semi A, 3-4->Round 6
Round 5 Upper.B: 1-2->Semi A, 3-4->Round 6
Round 5 Lower.A: 1-2->Round 6
Round 5 Lower.B: 1-2->Round 6
Semi A: 1-2->Final, 3-4->Semi-B
Round 6.A: 1-2->Round 7
Round 6.B: 1-2->Round 7
Round 7: 1-2->Semi-B
Semi-B: 1-2->Final
`;

/** The 32-player spreadsheet layout: [5], [SemiA, 6B, 6C], [7A], [SemiB], [Final]. */
const SPREADSHEET_GRAPH = `
ROUNDS:
5 = 4x8
6B = 8
6C = 8
7A = 8
SemiA = 8
SemiB = 8
Final = 8 FINAL

ROUTES:
5.A: 1-4->SemiA, 5,8->6B, 6,7->6C
5.B: 1-4->SemiA, 6,7->6B, 5,8->6C
5.C: 1,4->6C, 2,3->6B, 5-8->eliminated
5.D: 1,4->6B, 2,3->6C, 5-8->eliminated
SemiA: 1-4->Final, 5-8->SemiB
6B: 1-4->7A, 5-8->eliminated
6C: 1-4->7A, 5-8->eliminated
7A: 1-4->SemiB, 5-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated
`;

function teams(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `a${index}` }, { name: `b${index}` }],
  }));
}

/** The live tournament's shape: 2v2v2v2 teams, three qualification rounds, the live graph. */
function liveTournament(teamCount: number): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: teamCount, players: teams(teamCount) }),
    createDefaultSetup({
      gameFormat: 'team-2v2v2v2',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '99',
      waterfallGraph: LIVE_GRAPH,
    }),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
  return { ...result.state, started: true };
}

const indexOf = (state: TournamentState, label: string) =>
  state.rounds.findIndex((round) => round.customLabel === label);
const seated = (state: TournamentState, label: string) =>
  (state.assignments[indexOf(state, label)] ?? []).map((entry) => entry.name);
const advance = (state: TournamentState): TournamentState => {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') {
    throw new Error(`could not advance past round ${state.curRound}: ${JSON.stringify(result)}`);
  }
  return result.state;
};

/** Scores one round (not necessarily the current one), every score distinct. */
function scoreRound(state: TournamentState, label: string, teamSize: number): TournamentState {
  const scored = scoreCurrentRound({ ...state, curRound: indexOf(state, label) }, teamSize);
  return { ...scored, curRound: state.curRound };
}

/** Scores every round of the column in play. */
function scoreColumn(state: TournamentState, teamSize: number): TournamentState {
  const { start, end } = currentColumn(state);
  let current = state;
  for (let index = start; index <= end; index += 1) {
    current = scoreRound(current, state.rounds[index].customLabel as string, teamSize);
  }
  return current;
}

/** Plays every qualification round and advances into the bracket. */
function enterBracket(state: TournamentState, teamSize: number): TournamentState {
  let current = state;
  for (let guard = 0; guard < 20 && !current.rounds[current.curRound].isWaterfall; guard += 1) {
    current = advance(scoreCurrentRound(current, teamSize));
  }
  return current;
}

describe.each([
  [19, 3],
  [23, 7],
])('the live graph at %i teams (%i out at qualification)', (teamCount, eliminated) => {
  const start = enterBracket(liveTournament(teamCount), 2);

  it('draws Round 5 Upper and Round 5 Lower together when qualification ends', () => {
    expect(start.curRound).toBe(indexOf(start, 'Round 5 Upper'));
    expect(seated(start, 'Round 5 Upper')).toHaveLength(8);
    expect(seated(start, 'Round 5 Lower')).toHaveLength(8);
    expect(start.rounds[indexOf(start, 'Round 5 Lower')]).toMatchObject({
      waterfallColumn: 1,
      rooms: [4, 4],
    });
    expect(seated(start, 'Semi A')).toEqual([]);
    expect(teamCount - eliminated).toBe(16);
    const arrivals = new Set([...seated(start, 'Round 5 Upper'), ...seated(start, 'Round 5 Lower')]);
    expect(arrivals.size).toBe(16);
  });

  it('plays Round 5 Lower scored first, then Upper, and one Next Round draws Semi A and Round 6 together', () => {
    const lowerFirst = scoreRound(start, 'Round 5 Lower', 2);
    expect(lowerFirst.curRound).toBe(start.curRound);
    const bothScored = scoreRound(lowerFirst, 'Round 5 Upper', 2);
    const next = advance(bothScored);
    expect(next.curRound).toBe(indexOf(next, 'Semi A'));
    expect(seated(next, 'Semi A')).toHaveLength(4);
    expect(seated(next, 'Round 6')).toHaveLength(8);
    expect(seated(next, 'Round 7')).toEqual([]);
    expect(next.rounds[indexOf(next, 'Round 6')].waterfallColumn).toBe(2);
  });

  it('continues column by column to the Final of 4 teams', () => {
    let state = start;
    const seenColumns: number[] = [];
    for (let guard = 0; guard < 10 && !state.rounds[state.curRound].isFinal; guard += 1) {
      seenColumns.push(state.rounds[state.curRound].waterfallColumn as number);
      state = advance(scoreColumn(state, 2));
    }
    expect(seenColumns).toEqual([1, 2, 3, 4]);
    expect(state.rounds[state.curRound].customLabel).toBe('Final');
    expect(seated(state, 'Final')).toHaveLength(4);
  });
});

describe.each([
  [37, 5],
  [53, 21],
])('the 32-player spreadsheet layout with %i registered (%i out at qualification)', (registered) => {
  const start = (() => {
    const built = buildQualWaterfall(registered, SPREADSHEET_GRAPH, { qualAdv: '32' }, { columns: true });
    return enterBracket(built, 0);
  })();

  it('plays [5], [SemiA, 6B, 6C], [7A], [SemiB], [Final] to a Final of 8', () => {
    let state = start;
    const columns: string[][] = [];
    for (let guard = 0; guard < 10 && !state.rounds[state.curRound].isFinal; guard += 1) {
      const { start, end } = currentColumn(state);
      const labels = state.rounds.slice(start, end + 1).map((round) => round.customLabel as string);
      columns.push(labels);
      state = advance(scoreColumn(state, 0));
    }
    expect(columns).toEqual([['5'], ['SemiA', '6B', '6C'], ['7A'], ['SemiB']]);
    expect(seated(state, 'Final')).toHaveLength(8);
  });

  it('sends each of 6B and 6C exactly 2 from each room of 5', () => {
    const scored = scoreColumn(start, 0);
    const roomOf = new Map(scored.assignments[indexOf(scored, '5')].map((entry) => [entry.name, entry.room]));
    const next = advance(scored);
    for (const label of ['6B', '6C']) {
      const fromRoom = [1, 2, 3, 4].map(
        (room) => seated(next, label).filter((name) => roomOf.get(name) === room).length,
      );
      expect(fromRoom).toEqual([2, 2, 2, 2]);
    }
  });
});

/** A tie between 2nd and 3rd in a room of 4, across the cut between ranks 2 and 3. */
function scoreWithTie(state: TournamentState, label: string): TournamentState {
  const index = indexOf(state, label);
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[index]) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    const values = [400, 300, 300, 100];
    const keys = scoreKeysForPosition({
      roundIndex: index,
      room: entry.room,
      position,
      numGames: 1,
      teamSize: 2,
    });
    keys.forEach((key, keyIndex) => {
      scores[key] = keyIndex === 0 ? values[position] : 0;
    });
  }
  return { ...state, scores };
}

describe('ties in a column', () => {
  const start = enterBracket(liveTournament(19), 2);

  it('a tie in Round 5 Lower blocks the whole column, and resolving it lets both rounds advance', () => {
    const tied = scoreWithTie(scoreRound(start, 'Round 5 Upper', 2), 'Round 5 Lower');
    expect(hasPendingColumnTies(tied)).toBe(true);
    const keys = Object.keys(getAllColumnTies(tied));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith(`r${indexOf(tied, 'Round 5 Lower')}-`))).toBe(true);
    const blocked = advanceTournamentRound(tied);
    expect(blocked.status).toBe('blocked');
    expect(blocked.status === 'blocked' && blocked.reason).toBe('pending-ties');

    let resolved = tied;
    for (const key of keys) {
      const cluster = getAllColumnTies(resolved)[key];
      for (const player of cluster.players) resolved = resolveTournamentTie(resolved, key, player.name);
    }
    expect(hasPendingColumnTies(resolved)).toBe(false);
    const next = advance(resolved);
    expect(next.curRound).toBe(indexOf(next, 'Semi A'));
    expect(seated(next, 'Round 6')).toHaveLength(8);
  });
});

describe('going back and forward over a column', () => {
  const start = enterBracket(liveTournament(19), 2);
  const inSecondColumn = advance(scoreColumn(start, 2));

  it('steps forward unchanged after Previous from column 2 to column 1', () => {
    const back = { ...inSecondColumn, curRound: start.curRound };
    expect(drawnAheadStatus(back, back.curRound)).toBe('locked');
    const forward = advance(back);
    expect(forward.curRound).toBe(inSecondColumn.curRound);
    expect(forward.assignments).toEqual(inSecondColumn.assignments);
  });

  it('re-draws every round of column 1 from the qualification round when nothing in it is scored', () => {
    const lastQual = start.rounds.map((round) => Boolean(round.isQual)).lastIndexOf(true);
    const back = { ...start, curRound: lastQual };
    expect(drawnAheadStatus(back, lastQual)).toBe('redraw');
    const again = advance(back);
    expect(again.curRound).toBe(start.curRound);
    expect(seated(again, 'Round 5 Upper')).toHaveLength(8);
    expect(seated(again, 'Round 5 Lower')).toHaveLength(8);
    expect(new Set([...seated(again, 'Round 5 Upper'), ...seated(again, 'Round 5 Lower')]).size).toBe(16);
  });

  it('locks column 1 once a score has been entered in any round of it', () => {
    const lastQual = start.rounds.map((round) => Boolean(round.isQual)).lastIndexOf(true);
    const scored = { ...scoreRound(start, 'Round 5 Lower', 2), curRound: lastQual };
    expect(drawnAheadStatus(scored, lastQual)).toBe('locked');
    const forward = advance(scored);
    expect(forward.curRound).toBe(start.curRound);
    expect(forward.assignments[start.curRound]).toEqual(scored.assignments[start.curRound]);
  });
});

describe('a tournament with no stored columns', () => {
  it('draws and advances one round at a time, as before columns existed', () => {
    const legacy = enterBracket(withoutColumns(liveTournament(19)), 2);
    expect(legacy.curRound).toBe(indexOf(legacy, 'Round 5 Upper'));
    expect(seated(legacy, 'Round 5 Upper')).toHaveLength(8);
    expect(seated(legacy, 'Round 5 Lower')).toEqual([]);
    const next = advance(scoreCurrentRound(legacy, 2));
    expect(next.curRound).toBe(indexOf(next, 'Round 5 Lower'));
    expect(seated(next, 'Round 5 Lower')).toHaveLength(8);
  });
});

describe('the Qual graph with its default columns: R1 and R1C are drawn together', () => {
  const exit = playToQualificationExit(buildQualWaterfall(37, QUAL_GRAPH, {}, { columns: true }));
  const entered = advance(exit);

  it('draws R1C (qualification ranks 17-24) with R1 (ranks 1-16): nobody waits in a pool', () => {
    expect(entered.curRound).toBe(indexOf(entered, 'R1'));
    expect(seated(entered, 'R1')).toHaveLength(16);
    expect(seated(entered, 'R1C')).toHaveLength(8);
    expect(Object.values(entered.pendingBracketSeeds).flat()).toEqual([]);
  });

  it('shows the R1C units as entries with a room, not as waiting', () => {
    const active = computeRankings(entered)?.stillActive ?? [];
    expect(active).toHaveLength(24);
    expect(active.every((entry) => entry.room !== null && entry.waitingFor === undefined)).toBe(true);
    expect(computeRankings(entered)?.eliminatedList).toHaveLength(13);
  });
});

describe('roster changes for a unit seated in the second round of a column', () => {
  const live = enterBracket(liveTournament(19), 2);
  const lower = indexOf(live, 'Round 5 Lower');
  const upper = indexOf(live, 'Round 5 Upper');
  const inRoomA = (state: TournamentState, index: number) =>
    state.assignments[index].find((entry) => entry.room === 1)?.name as string;

  it('finds the round of the column that holds the unit, and the first round when it holds none', () => {
    expect(roundInPlayOf(live, inRoomA(live, lower))).toBe(lower);
    expect(roundInPlayOf(live, inRoomA(live, upper))).toBe(upper);
    expect(roundInPlayOf(live, 'nobody')).toBe(live.curRound);
  });

  it('a withdrawal from Round 5 Lower room A: the room of 3 sends ranks 1-2 on, and Round 6 still arrives full', () => {
    const removed = removeRosterUnit(live, inRoomA(live, lower));
    expect(removed.assignments[lower].filter((entry) => entry.room === 1)).toHaveLength(3);
    expect(removed.assignments[upper]).toEqual(live.assignments[upper]);
    const next = advance(scoreColumn(removed, 2));
    expect(next.rounds[indexOf(next, 'Round 6')].rooms).toEqual([4, 4]);
    expect(seated(next, 'Round 6')).toHaveLength(8);
    expect(seated(next, 'Semi A')).toHaveLength(4);
  });

  it('a withdrawal from Round 5 Upper room A: Round 6 arrives with 7 as [4, 3]', () => {
    const removed = removeRosterUnit(live, inRoomA(live, upper));
    const next = advance(scoreColumn(removed, 2));
    expect(next.rounds[indexOf(next, 'Round 6')].rooms).toEqual([4, 3]);
    expect(seated(next, 'Round 6')).toHaveLength(7);
    expect(seated(next, 'Semi A')).toHaveLength(4);
  });

  it('a withdrawal drops that seat’s score in the unit’s own round, not in the first round of the column', () => {
    const scored = scoreColumn(live, 2);
    const removed = removeRosterUnit(scored, inRoomA(live, lower));
    const roomKeys = (state: TournamentState, index: number) =>
      Object.keys(state.scores).filter((key) => key.startsWith(`r${index}-rm1-`)).length;
    expect(roomKeys(removed, upper)).toBe(roomKeys(scored, upper));
    expect(roomKeys(removed, lower)).toBeLessThan(roomKeys(scored, lower));
  });

  it('a defender change records the round the team is in, not the first round of the column', () => {
    const lowerTeam = inRoomA(live, lower);
    const upperTeam = inRoomA(live, upper);
    const changed = setTeamDefender(setTeamDefender(live, lowerTeam, 1), upperTeam, 1);
    expect(changed.defenderChanges[lowerTeam]).toEqual([{ round: lower, memberIdx: 1 }]);
    expect(changed.defenderChanges[upperTeam]).toEqual([{ round: upper, memberIdx: 1 }]);
    expect(getDefenderIndex(changed, lowerTeam, lower)).toBe(1);
  });
});

describe('a swap for a unit seated in the second round of a column', () => {
  // This graph routes every registered unit, so nobody is eliminated and the swap window stays open.
  const entered = advance(
    playToQualificationExit(buildQualWaterfall(37, ALL_ROUTED_GRAPHS[37], {}, { columns: true })),
  );

  it('replaces the unit in its own round and leaves the first round alone', () => {
    const r1c = indexOf(entered, 'R1C');
    const old = entered.assignments[r1c][0].name;
    const swapped = swapIndividual(entered, old, 'Sub');
    expect(swapped.assignments[r1c].some((entry) => entry.name === 'Sub')).toBe(true);
    expect(swapped.assignments[r1c].some((entry) => entry.name === old)).toBe(false);
    expect(swapped.assignments[indexOf(entered, 'R1')]).toEqual(entered.assignments[indexOf(entered, 'R1')]);
  });
});
