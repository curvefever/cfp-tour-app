import { describe, expect, it } from 'vitest';
import { bestPlaceChoice } from '../../domain/tournament/best-place';
import { bracketFollowStatus, bracketRoundLabels } from '../../domain/tournament/bracket';
import { computeRankings } from '../../domain/tournament/rankings';
import { roundExitRule, type RoomExitBand } from '../../domain/tournament/room-exits';
import { describeStandings } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import {
  A,
  B,
  C,
  EXAMPLE,
  WITH_LOWER,
  scoreRooms,
  seatOf,
} from '../../domain/tournament/__tests__/best-place-fixtures';
import { atEntry, indexOf, pressed } from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { withDependencyPlay } from '../../domain/tournament/__tests__/qual-waterfall';
import { bracketLegend } from './bracket-legend';
import { roomExitLines } from './exit-lines';
import { placeInRoom } from './folded-round';
import { followBannerText } from './follow-text';
import { luckyLoserNames } from './room-row-inputs';
import { advanceResult, roomRowResult } from './room-row-result';

/** What the Bracket draws for a best place: the row stripe and star, the exit pop-up, the follow banner and the legend. */

const scoredExample = (graph = EXAMPLE) => {
  const entry = withDependencyPlay(atEntry(37, graph));
  return scoreRooms(entry, indexOf(entry, 'R4'), [A, B, C]);
};

function bandsOfRoom(state: TournamentState, room: number): RoomExitBand[] {
  const rule = roundExitRule(state, indexOf(state, 'R4'));
  if (rule.kind !== 'per-room') throw new Error('not a per-room round');
  return rule.rooms[room - 1];
}

/** The row of the unit at a seat of R4, as the room card draws it. */
function rowOf(state: TournamentState, room: number, position: number, decided: boolean) {
  const roundIndex = indexOf(state, 'R4');
  const name = seatOf(state, room, position);
  const rule = roundExitRule(state, roundIndex);
  return roomRowResult({
    rule,
    bands: rule.kind === 'per-room' ? rule.rooms[room - 1] : [],
    rank: placeInRoom(state, roundIndex, room, name)?.place ?? 1,
    lucky: luckyLoserNames(state, roundIndex).includes(name),
    pendingTie: false,
    roomComplete: true,
    roundDecided: decided,
  });
}

describe('the units a best place names, for the star', () => {
  it('are the chosen ones of the round', () => {
    const state = scoredExample();
    const r4 = indexOf(state, 'R4');
    expect(luckyLoserNames(state, r4)).toEqual(bestPlaceChoice(state, r4)?.chosen);
    expect(luckyLoserNames(state, r4)).toEqual([seatOf(state, 3, 5)]);
  });
});

describe('the rows of a room with a best place', () => {
  it('shows the 6ths as candidates, with an outline star, while the round is not sent on', () => {
    const state = scoredExample();
    for (const room of [1, 2, 3]) {
      expect(rowOf(state, room, 5, false)).toEqual({ result: 'candidate', star: 'candidate' });
    }
  });

  it('shows the chosen one in its destination colour with the decided star, the others out', () => {
    const state = pressed(scoredExample());
    expect(rowOf(state, 3, 5, true)).toEqual({ result: advanceResult({}), star: 'lucky' });
    expect(rowOf(state, 1, 5, true)).toEqual({ result: 'eliminate', star: null });
    expect(rowOf(state, 2, 5, true)).toEqual({ result: 'eliminate', star: null });
  });

  it('shows the others in the colour of the round that takes them when a Lower round does', () => {
    const state = pressed(scoredExample(WITH_LOWER));
    expect(rowOf(state, 1, 5, true)).toEqual({ result: advanceResult({ group: 1 }), star: null });
    expect(rowOf(state, 3, 5, true).star).toBe('lucky');
  });

  it('leaves the places around it as they were', () => {
    const state = pressed(scoredExample());
    expect(rowOf(state, 1, 4, true)).toEqual({ result: advanceResult({}), star: null });
    expect(rowOf(state, 1, 6, true)).toEqual({ result: 'eliminate', star: null });
  });
});

describe('the exit pop-up of a room with a best place', () => {
  it('names the rule: how many of the rooms, where they go and where the others go', () => {
    const state = scoredExample();
    const lines = roomExitLines(bandsOfRoom(state, 1), bracketRoundLabels(state));
    expect(lines.map((line) => [line.places, line.where])).toEqual([
      ['1–5', '→ R5'],
      ['6 ★', 'best 1 of 3 → R5, else out'],
      ['7–8', 'out'],
    ]);
    expect(lines[1].tone).toBe('dashed');
  });

  it('says where the others go when a Lower round takes them', () => {
    const state = scoredExample(WITH_LOWER);
    const lines = roomExitLines(bandsOfRoom(state, 1), bracketRoundLabels(state));
    expect(lines[1].where).toBe('best 1 of 3 → R5, else → R5L');
  });
});

describe('the follow banner on a best place', () => {
  const followed = (state: TournamentState, key: string) =>
    followBannerText(state, bracketFollowStatus(state, key), describeStandings(state), key).detail;

  it('says the place is a chance while the round is not sent on', () => {
    const state = scoredExample();
    expect(followed(state, seatOf(state, 1, 5))).toBe('R4 · Room A · 6th · best 6th? → R5');
  });

  it('says where each 6th goes once the round is sent on', () => {
    const lower = pressed(scoredExample(WITH_LOWER));
    expect(followed(lower, seatOf(lower, 1, 5))).toContain('6th → R5L');
    const out = pressed(scoredExample());
    expect(followed(out, seatOf(out, 1, 5))).toBe('Out in R4 · Room A · 6th');
  });
});

describe('the colour key with a best place', () => {
  it('has a Best of a place row with the star, and its rule in place of the fair cut text', () => {
    const legend = bracketLegend(scoredExample());
    expect(legend.rows.find((row) => row.name === 'Best of a place')).toMatchObject({
      tone: 'green',
      star: true,
    });
    expect(legend.luckyLosers).toBe(true);
    expect(legend.luckyText).toBe("The best of a place is chosen by score relative to the room's average.");
  });
});

/** C7-1: the rows the Bracket draws red are the units Rankings counts out of the round, before and after it is sent on. */
describe.each([
  ['the rest out', EXAMPLE],
  ['the rest to a Lower round', WITH_LOWER],
])('the Bracket and Rankings agree on every unit of R4, %s', (_label, graph) => {
  const sets = (state: TournamentState, decided: boolean) => {
    const r4 = indexOf(state, 'R4');
    const redInBracket = new Set<string>();
    for (const room of [1, 2, 3]) {
      for (let position = 0; position < 8; position += 1) {
        const name = seatOf(state, room, position);
        if (rowOf(state, room, position, decided).result === 'eliminate') redInBracket.add(name);
      }
    }
    const outInRankings = new Set(
      (computeRankings(state)?.eliminatedList ?? [])
        .filter((entry) => entry.ri === r4)
        .map((entry) => entry.name),
    );
    return { redInBracket, outInRankings };
  };

  it('before the round is sent on', () => {
    const { redInBracket, outInRankings } = sets(scoredExample(graph), false);
    expect(redInBracket.size).toBe(6);
    expect(outInRankings).toEqual(redInBracket);
  });

  it('after it is sent on', () => {
    const { redInBracket, outInRankings } = sets(pressed(scoredExample(graph)), true);
    expect(redInBracket.size).toBe(graph === EXAMPLE ? 8 : 6);
    expect(outInRankings).toEqual(redInBracket);
  });
});
