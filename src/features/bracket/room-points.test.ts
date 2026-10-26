import { describe, expect, it } from 'vitest';
import {
  buildState,
  scoreCurrentRound,
  withEarlierPointsRule,
} from '../../domain/tournament/__tests__/play-through';
import { shareTiedPoints } from '../../domain/tournament/mutations';
import { describeStandings } from '../../domain/tournament/standings-display';
import { scoreKeysForPosition } from '../../domain/tournament/scoring';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { roomPoints } from './room-points';

function start(
  count: number,
  setup: Partial<PersistedSetup> = {},
  gameFormat: PersistedSetup['gameFormat'] = 'ffa-individual',
) {
  const state = buildState({
    label: `${count}`,
    count,
    teams: false,
    setup: {
      gameFormat,
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '16',
      ...setup,
    },
  });
  if (!state) throw new Error('generation failed');
  return withEarlierPointsRule(state);
}

/** Scores the given rooms of the current round: the first seat highest, descending by seat. */
function scoreRooms(state: TournamentState, rooms: number[]): TournamentState {
  const scores = { ...state.scores };
  const seats = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null || !rooms.includes(entry.room)) continue;
    const position = seats.get(entry.room) ?? 0;
    seats.set(entry.room, position + 1);
    for (const key of scoreKeysForPosition({ roundIndex: state.curRound, room: entry.room, position })) {
      scores[key] = 100 - position * 3;
    }
  }
  return { ...state, scores };
}

describe.each([31, 37, 43])('roomPoints with %i players', (count) => {
  it('has the points of the rooms that are fully scored, and of no other room', () => {
    const state = scoreRooms(start(count), [1, 2]);
    const points = roomPoints(describeStandings(state), 0);
    const seated = (state.assignments[0] ?? []).filter((entry) => entry.room === 1 || entry.room === 2);
    expect([...points.keys()].sort()).toEqual(seated.map((entry) => entry.name).sort());
  });

  it('gives Standard points: 1st the largest room size, one less per place', () => {
    const state = scoreRooms(start(count), [1]);
    const points = roomPoints(describeStandings(state), 0);
    const room = (state.assignments[0] ?? []).filter((entry) => entry.room === 1);
    expect(room.map((entry) => points.get(entry.name))).toEqual(room.map((_, index) => 8 - index));
  });
});

describe('roomPoints', () => {
  it('is empty before any room is scored', () => {
    expect(roomPoints(describeStandings(start(37)), 0).size).toBe(0);
  });

  it('is empty without a standings phase', () => {
    expect(roomPoints(null, 0).size).toBe(0);
  });

  it("keeps each round apart: only the asked round's points", () => {
    const first = scoreRooms(start(37), [1, 2, 3, 4, 5]);
    expect(roomPoints(describeStandings(first), 0).size).toBe(37);
    expect(roomPoints(describeStandings(first), 1).size).toBe(0);
  });

  it('gives units sharing a place the average of the places they cover (37 players: 2nd and 3rd earn 6.5)', () => {
    const scored = scoreRooms(start(37), [1]);
    const names = (scored.assignments[0] ?? [])
      .filter((entry) => entry.room === 1)
      .map((entry) => entry.name);
    const scores = { ...scored.scores, 'r0-rm1-p1': 95, 'r0-rm1-p2': 95 };
    const state = shareTiedPoints({ ...scored, scores }, 'r0-rm1-s95', [names[1], names[2]]);
    const points = roomPoints(describeStandings(state), 0);
    expect([names[0], names[1], names[2], names[3]].map((name) => points.get(name))).toEqual([
      8, 6.5, 6.5, 5,
    ]);
  });

  it('uses the Custom points table', () => {
    const state = scoreRooms(
      start(37, { scoring: 'positional-points', positionalPointsTable: '10,7,5,4,3,2,1,0' }),
      [1],
    );
    const points = roomPoints(describeStandings(state), 0);
    const room = (state.assignments[0] ?? []).filter((entry) => entry.room === 1);
    expect(room.map((entry) => points.get(entry.name))).toEqual([10, 7, 5, 4, 3, 2, 1, 0]);
  });

  it('leaves a bye out (head-to-head, 33 players): it earns points but sits in no room', () => {
    const state = scoreCurrentRound(
      start(33, { poolingPhase: 'qual-table', oddCountStrategy: 'bye' }, 'individual-1v1'),
      0,
    );
    const byeName = state.byes[0]?.[0];
    expect(byeName).toBeTruthy();
    const points = roomPoints(describeStandings(state), 0);
    expect(points.has(byeName ?? '')).toBe(false);
    expect(points.size).toBe(32);
  });

  it('works in a group stage (13 head-to-head players)', () => {
    const state = scoreRooms(
      start(
        13,
        { poolingPhase: 'group-stage', groupSize: '4', qualifiersPerGroup: '2', oddCountStrategy: 'bye' },
        'individual-1v1',
      ),
      [1, 2],
    );
    const points = roomPoints(describeStandings(state), 0);
    expect(points.size).toBe(4);
    expect([...points.values()].sort()).toEqual([1, 1, 2, 2]);
  });
});
