import { describe, expect, it } from 'vitest';
import { projectFutureRoundSlots } from '../bracket';
import { fairCutAdvancement, fairCutRace } from '../fair-cut';
import { exitBandAtRank, roundExitRule, type RoomExitBand } from '../room-exits';
import type { TournamentState } from '../types';
import {
  SE_2V2V2V2,
  SE_FFA,
  firstEliminationIndex,
  generate,
  randomScores,
  seatedAndScored,
  withRoundShape,
  type Setup,
} from './fair-cut-fixtures';
import { withEarlierCutRule } from './play-through';
import { ONE_SCORE_PER_TEAM } from '../formats';

/** What the Bracket shows of the fair cut: the exit bands, the race and the projected slots. */

const SHARED_FINAL_FFA: Setup = {
  gameFormat: 'ffa-individual',
  scheduleLogic: 'double-elimination-shared-final',
  poolingPhase: 'none',
};

function bandsOf(state: TournamentState, roundIndex: number): RoomExitBand[][] {
  const rule = roundExitRule(state, roundIndex);
  if (rule.kind !== 'per-room') throw new Error(`no per-room rule: ${rule.kind}`);
  return rule.rooms;
}

describe('exit bands under the fair cut', () => {
  it('2v2v2v2 31: the rooms of 4 and the room of 3 each carry their own range', () => {
    const state = generate('2v2v2v2 31', 31, SE_2V2V2V2);
    const index = firstEliminationIndex(state);
    const rooms = bandsOf(state, index);
    expect(rooms[0]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 3, destination: index + 1 },
      { kind: 'lucky-chance', rank: 4, spots: 3, minSpots: 2, size: 4, rooms: 7, otherwise: 'eliminate' },
    ]);
    expect(rooms[7]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 2, destination: index + 1 },
      { kind: 'lucky-chance', rank: 3, spots: 1, minSpots: 0, size: 3, rooms: 1, otherwise: 'eliminate' },
    ]);
  });

  it('FFA 43: the room of 8 and the rooms of 7', () => {
    const state = generate('FFA 43', 43, SE_FFA);
    const rooms = bandsOf(state, firstEliminationIndex(state));
    expect(rooms[0].map((band) => band.kind)).toEqual(['advance', 'lucky-chance', 'eliminate']);
    expect(rooms[0][1]).toMatchObject({ rank: 7, spots: 1, minSpots: 0, size: 8, rooms: 1 });
    expect(rooms[1][1]).toMatchObject({ rank: 6, spots: 4, minSpots: 3, size: 7, rooms: 5 });
    expect(rooms[1][2]).toEqual({ kind: 'eliminate', fromRank: 7, toRank: 7 });
  });

  it('equal rooms keep the earlier bands, with no range or group on the lucky band', () => {
    const state = generate('FFA 32', 32, SE_FFA);
    const index = state.rounds.findIndex(
      (round, roundIndex) => roundIndex >= firstEliminationIndex(state) && round.luckyCount > 0,
    );
    expect(index).toBeGreaterThan(0);
    expect(bandsOf(state, index)).toEqual(bandsOf(withEarlierCutRule(state), index));
    for (const bands of bandsOf(state, index)) {
      for (const band of bands) if (band.kind === 'lucky-chance') expect(band.size).toBeUndefined();
    }
  });

  it('a double elimination winners round drops the rest, and a lucky chance falls back to a drop', () => {
    const state = generate('FFA 37 DE', 37, SHARED_FINAL_FFA);
    const index = firstEliminationIndex(state);
    const round = state.rounds[index];
    const rooms = bandsOf(state, index);
    expect(rooms[0]).toEqual([
      { kind: 'advance', fromRank: 1, toRank: 6, destination: round.winnersTo },
      {
        kind: 'lucky-chance',
        rank: 7,
        spots: 1,
        minSpots: 0,
        size: 8,
        rooms: 2,
        otherwise: { drop: round.losersTo },
      },
      { kind: 'drop', fromRank: 8, toRank: 8, destination: round.losersTo },
    ]);
    expect(rooms[4]).toMatchObject([
      { kind: 'advance', toRank: 5 },
      { kind: 'lucky-chance', rank: 6, spots: 2, minSpots: 1, size: 7, rooms: 3 },
      { kind: 'drop', fromRank: 7, toRank: 7 },
    ]);
  });

  it('a size with no lucky spot has none: the losers round [3, 2] -> 2 sends the winner on and the rest out', () => {
    const state = generate('2v2v2 31 DE', 31, {
      gameFormat: 'team-2v2v2',
      teamScoringRule: ONE_SCORE_PER_TEAM,
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
    });
    const index = state.rounds.findIndex(
      (round) => round.bracket === 'losers' && round.rooms.join() === '3,2',
    );
    expect(bandsOf(state, index).map((bands) => bands.map((band) => band.kind))).toEqual([
      ['advance', 'eliminate'],
      ['advance', 'eliminate'],
    ]);
  });

  it('a size can carry two lucky chances in a row', () => {
    const base = generate('FFA 37', 37, SE_FFA);
    const index = firstEliminationIndex(base);
    const shaped = withRoundShape(base, index, {
      rooms: [8, 8, 8, 8, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2],
      advTotal: 19,
    });
    expect(bandsOf(shaped, index)[0]).toMatchObject([
      { kind: 'advance', fromRank: 1, toRank: 1 },
      { kind: 'lucky-chance', rank: 2, spots: 4, minSpots: 3, size: 8, rooms: 4 },
      { kind: 'lucky-chance', rank: 3, spots: 1, minSpots: 0, size: 8, rooms: 4 },
      { kind: 'eliminate', fromRank: 4, toRank: 8 },
    ]);
  });

  const COUNTS: Array<[string, number, Setup]> = [
    ['2v2v2v2 17', 17, SE_2V2V2V2],
    ['2v2v2v2 31', 31, SE_2V2V2V2],
    ['2v2v2v2 53', 53, SE_2V2V2V2],
    ['FFA 37', 37, SE_FFA],
    ['FFA 43', 43, SE_FFA],
    ['FFA 53', 53, SE_FFA],
    ['FFA 37 double elimination', 37, SHARED_FINAL_FFA],
  ];

  it.each(COUNTS)('%s: the bands agree with who the cut really advances', (label, count, setup) => {
    const base = generate(label, count, setup);
    const index = firstEliminationIndex(base);
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = seatedAndScored(base, index, randomScores(base.rounds[index].rooms, seed));
      const rooms = bandsOf(state, index);
      const result = fairCutAdvancement(state, index);
      const advancing = new Set(result.advancing.map((entry) => entry.name));
      for (const group of result.groups) {
        const spots = new Map<number, number>();
        for (const unit of group.ranked) {
          const band = exitBandAtRank(rooms[unit.room - 1], unit.place);
          if (band?.kind === 'advance') expect(advancing.has(unit.name)).toBe(true);
          else if (band?.kind === 'eliminate' || band?.kind === 'drop') {
            expect(advancing.has(unit.name)).toBe(false);
          } else if (band?.kind === 'lucky-chance') {
            spots.set(unit.place, (spots.get(unit.place) ?? 0) + (advancing.has(unit.name) ? 1 : 0));
          }
        }
        for (const place of group.chancePlaces) {
          expect(spots.get(place.place) ?? 0).toBeGreaterThanOrEqual(place.minSpots);
          expect(spots.get(place.place) ?? 0).toBeLessThanOrEqual(place.maxSpots);
        }
      }
    }
  });
});

describe('the lucky-loser race', () => {
  const base = generate('2v2v2v2 31', 31, SE_2V2V2V2);
  const index = firstEliminationIndex(base);
  const WORKED = [
    [40, 30, 20, 10],
    [35, 30, 25, 10],
    [32, 28, 22, 18],
    [45, 25, 18, 12],
    [38, 27, 21, 14],
    [33, 29, 22, 16],
    [60, 20, 12, 8],
    [50, 30, 20],
  ];

  it('lists each room size that has spots, the largest first, with the unit in line for the spare cut', () => {
    const race = fairCutRace(seatedAndScored(base, index, WORKED), index);
    expect(race?.groups.map((group) => [group.size, group.rooms, group.minSpots, group.maxSpots])).toEqual([
      [4, 7, 2, 3],
      [3, 1, 0, 1],
    ]);
    const [fours, threes] = race?.groups ?? [];
    expect(fours.units.map((unit) => unit.name)).toEqual([
      'R3P4',
      'R6P4',
      'R5P4',
      'R4P4',
      'R1P4',
      'R2P4',
      'R7P4',
    ]);
    expect(fours.units.slice(0, 4).map((unit) => [unit.name, unit.leading, unit.spareCut])).toEqual([
      ['R3P4', true, false],
      ['R6P4', true, false],
      ['R5P4', true, true],
      ['R4P4', false, false],
    ]);
    expect(threes.units).toMatchObject([{ name: 'R8P3', leading: false, spareCut: true }]);
    expect(race?.spareCuts).toHaveLength(1);
  });

  it('is absent for a round with one room size and for a tournament without cutVersion', () => {
    const equal = generate('FFA 32', 32, SE_FFA);
    const at = firstEliminationIndex(equal);
    expect(fairCutRace(seatedAndScored(equal, at, randomScores(equal.rounds[at].rooms, 3)), at)).toBeNull();
    expect(fairCutRace(withEarlierCutRule(seatedAndScored(base, index, WORKED)), index)).toBeNull();
  });

  it('leaves out a room with no scores yet', () => {
    const scores = WORKED.map((room, roomIndex) => (roomIndex === 2 ? room.map(() => 0) : room));
    const race = fairCutRace(seatedAndScored(base, index, scores), index);
    expect(race?.groups[0].units.map((unit) => unit.room)).not.toContain(3);
  });

  it('covers every chance place when a size has two', () => {
    const shaped = withRoundShape(generate('FFA 37', 37, SE_FFA), 2, {
      rooms: [8, 8, 8, 8, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2],
      advTotal: 19,
    });
    const race = fairCutRace(seatedAndScored(shaped, 2, randomScores(shaped.rounds[2].rooms, 9)), 2);
    const eights = race?.groups.find((group) => group.size === 8);
    expect(eights?.units).toHaveLength(8);
  });
});

describe('projected slots of the round after a fair cut', () => {
  it.each([
    ['2v2v2v2 31', 31],
    ['2v2v2v2 37', 37],
  ])(
    '%s: the places each size sends on, then the lucky losers, fill the next round exactly',
    (label, count) => {
      const state = generate(label, count, SE_2V2V2V2);
      const source = firstEliminationIndex(state);
      const slots = projectFutureRoundSlots(state)[source + 1];
      expect(slots).not.toBeNull();
      const flat = (slots ?? []).flat();
      expect(flat).toHaveLength(state.rounds[source + 1].players);
      expect(flat.filter((slot) => slot.kind === 'lucky')).toHaveLength(3);
      const ranks = flat.flatMap((slot) => (slot.kind === 'room-rank' ? [slot.rank] : []));
      const rooms = state.rounds[source].rooms;
      expect(Math.max(...ranks)).toBe(3);
      expect(ranks.filter((rank) => rank === 3)).toHaveLength(rooms.filter((size) => size === 4).length);
      expect(ranks.filter((rank) => rank === 1)).toHaveLength(rooms.length);
    },
  );

  it('a tournament without cutVersion keeps the earlier projection', () => {
    const state = withEarlierCutRule(generate('2v2v2v2 31', 31, SE_2V2V2V2));
    const source = firstEliminationIndex(state);
    const flat = (projectFutureRoundSlots(state)[source + 1] ?? []).flat();
    expect(flat.filter((slot) => slot.kind === 'lucky')).toHaveLength(state.rounds[source].luckyCount);
  });
});
