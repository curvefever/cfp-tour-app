import { describe, expect, it } from 'vitest';
import { computeRankings } from '../rankings';
import { scoreKeysForPosition } from '../scoring';
import { describeStandings } from '../standings-display';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState, scoreCurrentRound } from './play-through';
import { buildQualWaterfall, playToQualificationExit, tiedQualExit } from './qual-waterfall';

// Units leave Still in as soon as they are certainly out of the round in play, with no rank until it is advanced.

function advance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(result)}`);
  return result.state;
}

function generated(count: number, setup: Parameters<typeof buildState>[0]['setup']): TournamentState {
  const state = buildState({ label: `${count}`, count, teams: false, setup });
  if (!state) throw new Error('generation failed');
  return state;
}

/** 37 players past the two warm-ups: Round 3 in play, rooms of 8/8/7/7/7, 6 through per room and 2 lucky losers. */
function luckyRound37(): TournamentState {
  let state = generated(37, {
    gameFormat: 'ffa-individual',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'none',
    eliminationRoundTargets: '32,24',
  });
  while (state.rounds[state.curRound].isNoElim) state = advance(scoreCurrentRound(state, 0));
  return state;
}

/** The units of a room of the round in play, in seat order. */
function roomUnits(state: TournamentState, room: number): string[] {
  return (state.assignments[state.curRound] ?? [])
    .filter((entry) => entry.room === room)
    .map(({ name }) => name);
}

/** Scores the given rooms of the round in play: the n-th seat scores `scoreAt(n)` (by default each seat its own place). */
function scoreRooms(
  state: TournamentState,
  rooms: number[],
  scoreAt: (position: number) => number = (position) => 90 - position * 4,
): TournamentState {
  const scores = { ...state.scores };
  const numGames = state.rounds[state.curRound].numGames ?? 1;
  for (const room of rooms) {
    roomUnits(state, room).forEach((_, position) => {
      for (const key of scoreKeysForPosition({ roundIndex: state.curRound, room, position, numGames })) {
        scores[key] = scoreAt(position);
      }
    });
  }
  return { ...state, scores };
}

function rankings(state: TournamentState) {
  const result = computeRankings(state);
  if (!result) throw new Error('no rankings');
  return result;
}

const activeNames = (state: TournamentState) => new Set(rankings(state).stillActive.map(({ name }) => name));
const eliminatedRanks = (state: TournamentState) =>
  rankings(state).eliminatedList.map((entry) => [entry.name, entry.rank] as const);

describe('in play: a single-elimination round with lucky losers (37 players, rooms 8/8/7/7/7)', () => {
  const state = luckyRound37();
  const roomA = roomUnits(state, 1);
  const roomB = roomUnits(state, 2);

  it('is played in rooms of 8/8/7/7/7', () => {
    expect([1, 2, 3, 4, 5].map((room) => roomUnits(state, room).length)).toEqual([8, 8, 7, 7, 7]);
  });

  it('moves the 8th of a complete room with no rank, keeps its lucky-loser candidate and every other room', () => {
    const roomADone = scoreRooms(state, [1]);
    expect(eliminatedRanks(roomADone)).toEqual([[roomA[7], null]]);
    const active = activeNames(roomADone);
    expect(active.has(roomA[6])).toBe(true);
    expect(active.size).toBe(36);
  });

  it('moves nobody from a room still being scored', () => {
    const partial = scoreRooms(state, [1], (position) => (position === 3 ? Number.NaN : 90 - position * 4));
    const withHole = {
      ...partial,
      scores: Object.fromEntries(Object.entries(partial.scores).filter(([, value]) => !Number.isNaN(value))),
    };
    expect(rankings(withHole).eliminatedList).toEqual([]);
  });

  it('gives the early-eliminated units their numbers once the round is advanced', () => {
    const allScored = scoreRooms(state, [1, 2, 3, 4, 5]);
    expect(eliminatedRanks(allScored)).toEqual([
      [roomA[7], null],
      [roomB[7], null],
    ]);
    const advanced = rankings(advance(allScored));
    // 32 go on, so the 5 out rank 33-37: the 3 lucky-loser candidates not picked (7th), then the two 8ths, level.
    expect(advanced.eliminatedList.map((entry) => entry.rank)).toEqual([33, 33, 33, 36, 36]);
    const byName = new Map(advanced.eliminatedList.map((entry) => [entry.name, entry.rank]));
    expect([byName.get(roomA[7]), byName.get(roomB[7])]).toEqual([36, 36]);
  });

  it('keeps both units of an unresolved tie across the cut, and moves the loser once it is resolved', () => {
    const tied = scoreRooms(state, [1], (position) => (position === 7 ? 90 - 6 * 4 : 90 - position * 4));
    expect(rankings(tied).eliminatedList).toEqual([]);
    const key = `r${state.curRound}-rm1-s${90 - 6 * 4}`;
    const resolved = { ...tied, tieResolutions: { ...tied.tieResolutions, [key]: [roomA[6]] } };
    expect(eliminatedRanks(resolved)).toEqual([[roomA[7], null]]);
  });

  it('moves nobody from a room left with a lone unit', () => {
    const lone = roomUnits(state, 5)[0];
    const assignments = state.assignments.map((list, index) =>
      index === state.curRound ? list.filter((entry) => entry.room !== 5 || entry.name === lone) : list,
    );
    const scored = scoreRooms({ ...state, assignments }, [5]);
    // The units taken out of the room read as eliminated by the warm-up before; nobody is out of this round.
    expect(rankings(scored).eliminatedList.filter((entry) => entry.ri === state.curRound)).toEqual([]);
    expect(activeNames(scored).has(lone)).toBe(true);
  });

  it('leaves the ranks of an advanced round as they were while the next round eliminates in play', () => {
    const nextRound = advance(scoreRooms(state, [1, 2, 3, 4, 5]));
    const before = eliminatedRanks(nextRound);
    const roomADone = scoreRooms(nextRound, [1]);
    const after = rankings(roomADone).eliminatedList;
    const inPlay = after.filter((entry) => entry.ri === nextRound.curRound);
    // Round 4 is played in rooms of 8 with 6 through and no lucky loser: 7th and 8th are out.
    expect(inPlay.map((entry) => [entry.name, entry.rank])).toEqual(
      roomUnits(nextRound, 1)
        .slice(6)
        .map((name) => [name, null]),
    );
    expect(
      after.filter((entry) => entry.ri !== nextRound.curRound).map((entry) => [entry.name, entry.rank]),
    ).toEqual(before);
  });
});

describe('in play: the last round of a qualification table (43 players, cut at 24)', () => {
  const lastQual = (() => {
    let state = generated(43, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
    });
    while (state.rounds[state.curRound + 1]?.isQual) state = advance(scoreCurrentRound(state, 0));
    return state;
  })();
  const roomCount = new Set((lastQual.assignments[lastQual.curRound] ?? []).map(({ room }) => room)).size;
  const everyRoom = Array.from({ length: roomCount }, (_, index) => index + 1);

  it('moves nobody while one room is still unscored', () => {
    expect(rankings(scoreRooms(lastQual, everyRoom.slice(0, -1))).eliminatedList).toEqual([]);
  });

  it('moves places 25-43 with no rank once every room is scored', () => {
    const complete = scoreRooms(lastQual, everyRoom);
    const table = describeStandings(complete)?.tables[0];
    const out = (table?.entries ?? []).slice(24).map(({ name }) => name);
    const eliminated = rankings(complete).eliminatedList;
    expect(out).toHaveLength(19);
    expect(eliminated.map(({ name }) => name).sort()).toEqual([...out].sort());
    expect(eliminated.every((entry) => entry.rank === null && entry.atCut)).toBe(true);
    expect(activeNames(complete).size).toBe(24);
  });
});

describe('in play: a qualification cut with an unresolved tie (Qual source, 32 units, ties of 4 at 21-24)', () => {
  const exit = tiedQualExit();
  const table = describeStandings(exit)?.tables[0];
  const names = (table?.entries ?? []).map(({ name }) => name);

  it('moves the out band past the tie and keeps the tied units', () => {
    const eliminated = rankings(exit).eliminatedList.map(({ name }) => name);
    expect(eliminated.sort()).toEqual(names.slice(24).sort());
    for (const name of names.slice(20, 24)) expect(activeNames(exit).has(name)).toBe(true);
  });

  it('moves the tied units the resolution places in the out band', () => {
    const [p21, p22, p23, p24] = names.slice(20, 24);
    const resolved = { ...exit, tieResolutions: { ...exit.tieResolutions, 'qual-cutoff': [p21, p22, p23] } };
    const eliminated = new Set(rankings(resolved).eliminatedList.map(({ name }) => name));
    expect([p21, p22].some((name) => eliminated.has(name))).toBe(false);
    expect(eliminated.has(p23) && eliminated.has(p24)).toBe(true);
  });
});

describe('in play: double elimination (31 units, head-to-head)', () => {
  const winnersRound = (() => {
    let state = generated(31, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'bye',
    });
    while (state.rounds[state.curRound].isNoElim) state = advance(scoreCurrentRound(state, 0));
    return state;
  })();

  it('keeps the loser of a complete winners-bracket room: it drops to the losers bracket', () => {
    expect(winnersRound.rounds[winnersRound.curRound].bracket).toBe('winners');
    const scored = scoreRooms(winnersRound, [1]);
    expect(rankings(scored).eliminatedList).toEqual([]);
    expect(activeNames(scored).has(roomUnits(winnersRound, 1)[1])).toBe(true);
  });

  it('moves the loser of a complete losers-bracket room', () => {
    let state = winnersRound;
    while (state.rounds[state.curRound].bracket !== 'losers') state = advance(scoreCurrentRound(state, 0));
    const loser = roomUnits(state, 1)[1];
    const scored = scoreRooms(state, [1]);
    const inPlay = rankings(scored).eliminatedList.filter((entry) => entry.rank === null);
    expect(inPlay.map(({ name }) => name)).toEqual([loser]);
  });
});

describe('in play: a waterfall round with an eliminated band (37 registered)', () => {
  it("moves a complete room's eliminated band and keeps the rest of the round", () => {
    const entered = advance(playToQualificationExit(buildQualWaterfall(37)));
    const roomA = roomUnits(entered, 1);
    const scored = scoreRooms(entered, [1]);
    const inPlay = rankings(scored).eliminatedList.filter((entry) => entry.rank === null);
    // R1 rooms send 1-4 on and eliminate 5-8.
    expect(inPlay.map(({ name }) => name).sort()).toEqual(roomA.slice(4).sort());
    for (const name of roomA.slice(0, 4)) expect(activeNames(scored).has(name)).toBe(true);
  });
});
