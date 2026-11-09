import { describe, expect, it } from 'vitest';
import { computeRankings } from '../rankings';
import { roundsInPlay } from '../round-columns';
import type { RoomSize, TournamentState } from '../types';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { canGoBack, goBack, isRoundScored } from '../waterfall-steps';
import {
  STRATEGIES,
  atEntry,
  drawsOf,
  indexOf,
  onlyFinalInPlay,
  playColumns,
  playDependency,
  pressed,
  scoreRound,
} from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * A round fed only by the Qual (or Groups) line may declare more seats than the line routes, by fewer seats than it has
 * rooms. It is drawn at the sizes that really arrive, from generation on, and the rounds after it follow.
 */

const FFA: RoomSize = { min: 6, ideal: 8, max: 8 };

/** The 8-unit upper and lower graph with the lower half's Qual band cut short: 17-31 instead of 17-32. */
const SHORT_GRAPH = UPPER_LOWER_GRAPH.replace('17-32->R4L', '17-31->R4L');
const COUNT = 31;

const entry = atEntry(COUNT, SHORT_GRAPH);
const sizeOf = (state: TournamentState, label: string) => state.rounds[indexOf(state, label)].rooms;
const declaredOf = (state: TournamentState, label: string) =>
  state.rounds[indexOf(state, label)].declaredRooms;

/** The rounds in play that a press needs scored: everything but the Final, not scored yet. */
const roundsToScore = (state: TournamentState): number[] =>
  roundsInPlay(state).filter((index) => !state.rounds[index].isFinal && !isRoundScored(state, index));

function validated(text: string, entrantCount: number) {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return validateAndOrderWaterfallGraph(parsed.value, { roomSize: FFA, entrantCount, standingsSource: true });
}

describe('a short entry round at generation', () => {
  it('draws the entry round at the sizes that arrive, keeping the declared ones', () => {
    expect(sizeOf(entry, 'R4U')).toEqual([8, 8]);
    expect(declaredOf(entry, 'R4U')).toBeUndefined();
    expect(sizeOf(entry, 'R4L')).toEqual([8, 7]);
    expect(declaredOf(entry, 'R4L')).toEqual([8, 8]);
    expect(entry.rounds[indexOf(entry, 'R4L')].players).toBe(15);
    expect(entry.rounds[indexOf(entry, 'R4L')].advTotal).toBe(15);
  });

  it('is generated with the line as the highest routed rank', () => {
    expect(entry.cfg.qualAdv).toBe(31);
  });

  it('sizes each later round by what really reaches it', () => {
    // R4L's second room has 7 places: a band over rank 8 of it is not there, so R5R receives 4 + 3.
    expect(sizeOf(entry, 'R5L')).toEqual([8, 8]);
    expect(sizeOf(entry, 'R5R')).toEqual([7]);
    expect(declaredOf(entry, 'R5R')).toEqual([8]);
    expect(sizeOf(entry, 'R6L')).toEqual([8]);
    expect(sizeOf(entry, 'R6R')).toEqual([8]);
    expect(sizeOf(entry, 'SemiA')).toEqual([8]);
    expect(sizeOf(entry, 'SemiB')).toEqual([8]);
    expect(sizeOf(entry, 'Final')).toEqual([8]);
  });

  it('draws the rooms of the short round with the units that arrive', () => {
    const lineup = entry.assignments[indexOf(entry, 'R4L')];
    expect(lineup.filter((unit) => unit.room === 1)).toHaveLength(8);
    expect(lineup.filter((unit) => unit.room === 2)).toHaveLength(7);
  });

  it('leaves a graph with no short round exactly as it was', () => {
    const exact = atEntry(32, UPPER_LOWER_GRAPH);
    expect(exact.rounds.every((round) => round.declaredRooms === undefined)).toBe(true);
    expect(
      exact.rounds.every((round) => round.rooms.reduce((sum, size) => sum + size, 0) === round.players),
    ).toBe(true);
    expect(sizeOf(exact, 'R4L')).toEqual([8, 8]);
    expect(sizeOf(exact, 'R5R')).toEqual([8]);
  });
});

describe('what the validation allows', () => {
  const lineOnly = (qual: string) => `
ROUNDS:
A = 2x8
B = 2x8
Final = 8 FINAL

ROUTES:
Qual: ${qual}
A.A: 1-2->Final
A.B: 1-2->Final
B.A: 1-2->Final
B.B: 1-2->Final
`;

  it('accepts the exact graph', () => {
    expect(validated(lineOnly('1-16->A, 17-32->B'), 32).ok).toBe(true);
  });

  it('accepts a round fed only by the line that is one seat short', () => {
    expect(validated(lineOnly('1-16->A, 17-31->B'), 31).ok).toBe(true);
    expect(validated(lineOnly('1-15->A, 16-31->B'), 31).ok).toBe(true);
  });

  it('refuses a round short by as many seats as it has rooms, with the existing message', () => {
    const result = validated(lineOnly('1-16->A, 17-30->B'), 30);
    expect(result.ok ? '' : result.error).toContain(
      'Round "B" declares 16 player(s) but its routing bands only send it 14',
    );
  });

  it('refuses a short round that would leave a room under the format minimum', () => {
    const small = `
ROUNDS:
A = 2x8
B = 2x6
Final = 8 FINAL

ROUTES:
Qual: 1-16->A, 17-27->B
A.A: 1-2->Final
A.B: 1-2->Final
B.A: 1-2->Final
B.B: 1-2->Final
`;
    const result = validated(small, 27);
    expect(result.ok ? '' : result.error).toContain(
      'Round "B" declares 12 player(s) but its routing bands only send it 11',
    );
    expect(validated(small.replace('17-27->B', '17-28->B'), 28).ok).toBe(true);
  });

  it('refuses a short round that another round also feeds', () => {
    const fedByRound = `
ROUNDS:
A = 2x8
B = 2x8
Final = 8 FINAL

ROUTES:
Qual: 1-16->A, 17-23->B
A.A: 1-2->Final, 3-6->B
A.B: 1-2->Final, 3-6->B
B.A: 1-2->Final
B.B: 1-2->Final
`;
    const result = validated(fedByRound, 23);
    expect(result.ok ? '' : result.error).toContain(
      'Round "B" declares 16 player(s) but its routing bands only send it 15',
    );
    expect(validated(fedByRound.replace('17-23->B', '17-24->B'), 24).ok).toBe(true);
  });

  it('keeps refusing a round that is routed more than it declares', () => {
    const result = validated(lineOnly('1-16->A, 17-33->B'), 33);
    expect(result.ok ? '' : result.error).toContain(
      'Round "B" declares 16 player(s) but its routing bands only send it 17',
    );
  });
});

describe('played to the Final', () => {
  const reference = drawsOf(playColumns(entry));

  function rankedOnce(state: TournamentState): void {
    const rankings = computeRankings(state);
    const names = [
      ...(rankings?.stillActive ?? []),
      ...(rankings?.finalists ?? []),
      ...(rankings?.eliminatedList ?? []),
      ...(rankings?.dnfList ?? []),
    ].map((unit) => unit.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(COUNT);
  }

  it('lists every unit once in Rankings in column play, and the Final has 8', () => {
    const played = playColumns(entry, (state) => {
      rankedOnce(state);
      return state;
    });
    rankedOnce(played);
    expect(played.assignments[indexOf(played, 'Final')]).toHaveLength(8);
    expect(played.assignments[indexOf(played, 'R5R')]).toHaveLength(7);
  });

  it.each(Object.entries(STRATEGIES))(
    "%s gives column play's draws and lists every unit once after every press",
    (_name, strategy) => {
      const played = playDependency(entry, strategy, (state) => {
        rankedOnce(state);
        return state;
      });
      expect(drawsOf(played)).toEqual(reference);
    },
  );
});

describe('Previous and the graph save at every press', () => {
  it('Previous returns the state as it was before the press, with the short rounds', () => {
    let state = withDependencyPlay(entry);
    expect(canGoBack(state)).toBe(true);
    let presses = 0;
    for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
      for (const index of roundsToScore(state)) state = scoreRound(state, index);
      const before = state;
      state = pressed(before);
      const back = goBack(state);
      expect(back.rounds).toEqual(before.rounds);
      expect(back.assignments).toEqual(before.assignments);
      presses += 1;
    }
    expect(presses).toBeGreaterThan(2);
  });

  it('a save of the unchanged text succeeds at every press and changes no round', () => {
    let state = withDependencyPlay(entry);
    const text = state.settings?.waterfallGraph ?? '';
    expect(text).toContain('17-31->R4L');
    let saves = 0;
    for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
      for (const index of roundsToScore(state)) state = scoreRound(state, index);
      state = pressed(state);
      const saved = applyWaterfallGraphEdit(state, text);
      expect(saved.ok ? '' : saved.error).toBe('');
      if (saved.ok) {
        expect(saved.state.rounds.map((round) => round.rooms)).toEqual(
          state.rounds.map((round) => round.rooms),
        );
      }
      saves += 1;
    }
    expect(saves).toBeGreaterThan(2);
  });
});
