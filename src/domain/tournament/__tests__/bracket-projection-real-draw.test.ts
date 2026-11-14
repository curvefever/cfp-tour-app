import { describe, expect, it } from 'vitest';
import { bracketRoundLabels, projectFutureRoundSlots, type ProjectedSlotLabel } from '../bracket';
import type { TournamentState } from '../types';
import { generated } from './test-fixtures';

/** A Custom bracket round's projected rooms, or an error naming the round when it has none. */
function projectedRooms(state: TournamentState, label: string): ProjectedSlotLabel[][] {
  const index = state.rounds.findIndex((round) => round.customLabel === label);
  const rooms = projectFutureRoundSlots(state)[index];
  if (!rooms) throw new Error(`no projection for ${label}`);
  return rooms;
}

const letter = (room: number): string => String.fromCharCode(64 + room);

/** `A5` for a slot that comes from a waterfall room (room A, place 5) of the source named `source`. */
function fromSource(slots: ProjectedSlotLabel[], source: string): string[] {
  return slots.flatMap((slot) =>
    slot.kind === 'waterfall-rank' && slot.sourceLabel === source ? [`${letter(slot.room)}${slot.rank}`] : [],
  );
}

/** The graph of the 8th Anniversary FFA tournament: 36 qualifiers from the table, three waves, two lower rounds. */
const ANNIVERSARY_GRAPH = `ROUNDS:
Round 5 Upper = 2x8
Round 5 Middle = 2x6
Semi A = 8 GAMES 2
Round 6 Lower = 8
Round 6 Middle = 2x7
Semi B = 8 GAMES 2
Round 5 Lower = 8
Round 7 Upper = 2x6
Round 7 Lower = 8
Round 8 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->Round 5 Upper, 17-28->Round 5 Middle, 29-36->Round 5 Lower
Round 5 Upper.A: 1-4->Semi A, 5-8->Round 6 Middle
Round 5 Upper.B: 1-4->Semi A, 5-8->Round 6 Middle
Round 5 Middle.A: 1-3->Round 6 Middle, 4-6->Round 6 Lower
Round 5 Middle.B: 1-3->Round 6 Middle, 4-6->Round 6 Lower
Semi A: 1-4->Final, 5-8->Round 7 Upper
Round 6 Lower: 1-2->Round 7 Lower
Round 6 Middle.A: 1-4->Round 7 Upper, 5-7->Round 7 Lower
Round 6 Middle.B: 1-4->Round 7 Upper, 5-7->Round 7 Lower
Semi B: 1-4->Final
Round 5 Lower: 1-2->Round 6 Lower
Round 7 Upper.A: 1-3->Semi B, 4-6->Round 8
Round 7 Upper.B: 1-3->Semi B, 4-6->Round 8
Round 7 Lower: 1-2->Round 8
Round 8: 1-2->Semi B`;

function anniversary(): TournamentState {
  return generated(48, {
    scheduleLogic: 'waterfall-bracket',
    gameFormat: 'ffa-individual',
    poolingPhase: 'qual-table',
    qualAdv: '36',
    qualRoundsOverride: '4',
    nonCountingRounds: '1',
    scoring: 'fairpoints',
    waterfallGraph: ANNIVERSARY_GRAPH,
    waterfallNumberedFrom: '5',
  });
}

describe('a Custom bracket round is previewed through the real draw', () => {
  it("seats a one-room source back and forth: the 8th Anniversary tournament's Round 7 Upper pairs Semi A 5 + 8 and 6 + 7", () => {
    const [first, second] = projectedRooms(anniversary(), 'Round 7 Upper');
    expect([fromSource(first, 'Semi A'), fromSource(second, 'Semi A')]).toEqual([
      ['A5', 'A8'],
      ['A6', 'A7'],
    ]);
  });

  it('gives each room of that round two units of each Round 6 Middle room, 6 seats each', () => {
    const rooms = projectedRooms(anniversary(), 'Round 7 Upper');
    expect(rooms.map((room) => room.length)).toEqual([6, 6]);
    for (const room of rooms) {
      const fromMiddle = fromSource(room, 'Round 6 Middle');
      expect(fromMiddle.filter((slot) => slot.startsWith('A'))).toHaveLength(2);
      expect(fromMiddle.filter((slot) => slot.startsWith('B'))).toHaveLength(2);
    }
  });

  it('keeps every room of three source rooms apart: 3 rooms of 6 fed by places 1-6 of 3 rooms hold 2 of each', () => {
    const graph = `ROUNDS:
Src = 3x8
Mid = 3x6
Final = 6 FINAL

ROUTES:
Qual: 1-24->Src
Src.A: 1-6->Mid, 7-8->eliminated
Src.B: 1-6->Mid, 7-8->eliminated
Src.C: 1-6->Mid, 7-8->eliminated
Mid.A: 1-2->Final, 3-6->eliminated
Mid.B: 1-2->Final, 3-6->eliminated
Mid.C: 1-2->Final, 3-6->eliminated`;
    const state = generated(28, {
      scheduleLogic: 'waterfall-bracket',
      gameFormat: 'ffa-individual',
      poolingPhase: 'qual-table',
      qualAdv: '24',
      waterfallGraph: graph,
    });
    for (const room of projectedRooms(state, 'Mid')) {
      const rooms = fromSource(room, 'Src').map((slot) => slot[0]);
      expect(rooms.sort()).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
    }
  });
});

/** What the routes send a round: one key per unit, the way the projection's slots read. */
function sentByRoutes(state: TournamentState, targetIndex: number): string[] {
  const labels = bracketRoundLabels(state);
  const keys: string[] = [];
  state.rounds.forEach((source, sourceIndex) => {
    source.standingsRoutes?.forEach((destination, offset) => {
      if (destination === targetIndex) keys.push(`Qualification|${offset + 1}`);
    });
    source.waterfallRoutes?.forEach((roomRoutes, roomOffset) => {
      roomRoutes.forEach((destination, rankOffset) => {
        if (destination === targetIndex)
          keys.push(`${labels[sourceIndex].label}|${roomOffset + 1}|${rankOffset + 1}`);
      });
    });
  });
  return keys.sort();
}

function projectedKeys(rooms: ProjectedSlotLabel[][]): string[] {
  return rooms
    .flat()
    .map((slot) => {
      if (slot.kind === 'standings-rank') return `Qualification|${slot.rank}`;
      if (slot.kind === 'waterfall-rank') return `${slot.sourceLabel}|${slot.room}|${slot.rank}`;
      throw new Error(`unexpected slot ${slot.kind}`);
    })
    .sort();
}

describe('the built-in upper and lower bracket keeps its slots and room sizes', () => {
  it.each([31, 37, 43, 53])(
    '%i players: every bracket round holds what the routes send, in its declared rooms',
    (count) => {
      const state = generated(count, {
        scheduleLogic: 'upper-lower',
        gameFormat: 'ffa-individual',
        qualAdv: '32',
      });
      const projected = projectFutureRoundSlots(state);
      const bracketRounds = state.rounds.flatMap((round, index) => (round.isWaterfall ? [index] : []));
      expect(bracketRounds.length).toBeGreaterThan(0);
      for (const index of bracketRounds) {
        const rooms = projected[index];
        expect(rooms, state.rounds[index].customLabel).not.toBeNull();
        expect(rooms?.map((room) => room.length)).toEqual(state.rounds[index].rooms);
        expect(projectedKeys(rooms ?? [])).toEqual(sentByRoutes(state, index));
      }
    },
  );
});
