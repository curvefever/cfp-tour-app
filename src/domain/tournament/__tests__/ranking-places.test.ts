import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { computeRankings } from '../rankings';
import { placesLine, rankingRoomPlaces } from '../ranking-places';
import { isRoundDone } from '../round-columns';
import { roundExitRule } from '../room-exits';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { playDependency, playToBracketEntry, STRATEGIES } from './dependency-play-fixtures';
import { rosterFor, testRuntime } from './test-fixtures';

/** The built-in upper and lower bracket of an FFA qualification table: Round 5 and Round 6 hold a ranking room each. */
function upperLower(count: number): TournamentState {
  const form = createDefaultSetup({
    gameFormat: 'ffa-individual',
    scheduleLogic: 'upper-lower',
    poolingPhase: 'qual-table',
  });
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
  if (result.status !== 'generated') throw new Error(result.message);
  return { ...result.state, started: true };
}

const rankingRounds = (state: TournamentState) =>
  state.rounds.flatMap((round, index) => (round.waterfallRanking ? [index] : []));

/** What Rankings numbers each unit of the ranking round that went out of it, read straight from `computeRankings`. */
function rankedOutOf(state: TournamentState, roundIndex: number): Map<string, number> {
  const ranked = new Map<string, number>();
  for (const unit of computeRankings(state)?.eliminatedList ?? []) {
    if (unit.ri === roundIndex && unit.rank !== null) ranked.set(unit.name, unit.rank);
  }
  return ranked;
}

describe('a ranking round', () => {
  it('has placement bands for every rank, never a plain elimination', () => {
    const state = upperLower(29);
    for (const index of rankingRounds(state)) {
      const rule = roundExitRule(state, index);
      expect(rule.kind).toBe('per-room');
      const bands = rule.kind === 'per-room' ? rule.rooms.flat() : [];
      expect(bands.length).toBeGreaterThan(0);
      expect(bands.every((band) => band.kind === 'eliminate' && band.placement === true)).toBe(true);
    }
  });

  it('a round that is not a ranking round has no places, nor a placement mark on its bands', () => {
    const state = upperLower(29);
    expect(rankingRoomPlaces(state, 0)).toBeNull();
    const plain = state.rounds.findIndex(
      (round) => round.isWaterfall && !round.waterfallRanking && !round.isFinal,
    );
    expect(rankingRoomPlaces(state, plain)).toBeNull();
    const rule = roundExitRule(state, plain);
    const bands = rule.kind === 'per-room' ? rule.rooms.flat() : [];
    expect(bands.some((band) => band.kind === 'eliminate' && band.placement)).toBe(false);
  });
});

describe('the places a ranking room shows are the places Rankings gives', () => {
  it.each([29, 31, 37, 53])(
    'FFA %i upper and lower, played to the Final in the five press orders',
    (count) => {
      const entered = playToBracketEntry(upperLower(count));
      let numbered = 0;
      for (const [name, strategy] of Object.entries(STRATEGIES)) {
        playDependency(entered, strategy, (current) => {
          for (const index of rankingRounds(current)) {
            const places = rankingRoomPlaces(current, index);
            const ranked = rankedOutOf(current, index);
            expect([...(places?.byName ?? [])].sort(), `${name}: round ${index}`).toEqual([...ranked].sort());
            // Rankings numbers the round once it is sent on, and not before.
            if (isRoundDone(current, index)) expect(places, name).not.toBeNull();
            else expect(places, name).toBeNull();
            for (const [room, range] of places?.byRoom ?? []) {
              const units = [...(places?.byName ?? [])].filter(
                ([unit]) => current.assignments[index].find((entry) => entry.name === unit)?.room === room,
              );
              expect(range.first, name).toBe(Math.min(...units.map(([, place]) => place)));
              expect(range.last, name).toBe(Math.max(...units.map(([, place]) => place)));
            }
            numbered += places?.byName.size ?? 0;
          }
          return current;
        });
      }
      expect(numbered, `${count}`).toBeGreaterThan(0);
    },
  );
});

describe('placesLine', () => {
  it('reads a range, or a single place', () => {
    expect(placesLine({ first: 17, last: 22 })).toBe('Places 17–22');
    expect(placesLine({ first: 7, last: 7 })).toBe('Place 7');
  });
});
