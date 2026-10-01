import { describe, expect, it } from 'vitest';
import {
  nextPowerOf2AndRounds,
  raceDoubleEliminationBracketPhase,
  sharedFinalDoubleEliminationBracketPhase,
  type RaceDoubleEliminationConfig,
  type SharedFinalDoubleEliminationConfig,
} from '../double-elimination';
import { isSeatable } from '../room-distribution';
import type { RoomSize, TournamentRound } from '../types';

const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };
const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };

/** Longest run of consecutive WB rounds with no intervening LB round. */
function maxConsecutiveWbRounds(rounds: TournamentRound[]): number {
  let max = 0;
  let current = 0;
  for (const round of rounds) {
    if (round.bracket === 'winners') {
      current += 1;
      max = Math.max(max, current);
    } else if (round.bracket === 'losers') {
      current = 0;
    }
  }
  return max;
}

describe('nextPowerOf2AndRounds', () => {
  it('rounds up to the next power of 2 for a non-power-of-2 input', () => {
    expect(nextPowerOf2AndRounds(37)).toEqual({ bracketSize: 64, numRounds: 6 });
  });

  it('returns the input unchanged when already a power of 2', () => {
    expect(nextPowerOf2AndRounds(32)).toEqual({ bracketSize: 32, numRounds: 5 });
  });
});

describe('raceDoubleEliminationBracketPhase', () => {
  const baseConfig: RaceDoubleEliminationConfig = {
    roomSize: HEAD_TO_HEAD_ROOM_SIZE,
    oddCountStrategy: 'bye',
  };

  it('throws when roomSize.ideal !== 2', () => {
    expect(() =>
      raceDoubleEliminationBracketPhase(16, 1, { ...baseConfig, roomSize: FFA_ROOM_SIZE }),
    ).toThrow();
  });

  it("throws when oddCountStrategy is 'flex'", () => {
    expect(() =>
      raceDoubleEliminationBracketPhase(16, 1, { ...baseConfig, oddCountStrategy: 'flex' }),
    ).toThrow();
  });

  it('throws when the field is too small for at least 2 winners-bracket rounds', () => {
    expect(() => raceDoubleEliminationBracketPhase(2, 1, baseConfig)).toThrow();
  });

  it('concentrates ALL of the shortfall into WB round 0, unlike single-elimination.ts', () => {
    const rounds = raceDoubleEliminationBracketPhase(19, 1, baseConfig);
    const wb0 = rounds[0];
    expect(wb0.bracket).toBe('winners');
    expect(wb0.bracketPhaseFirstRound).toBe(true);
    // nextPowerOf2AndRounds(19) -> bracketSize 32, so round 0 must absorb the
    // entire 13-unit shortfall at once, not the usual self-correcting <=1.
    expect(wb0.byeCount).toBe(13);
    expect(wb0.rooms).toEqual([2, 2, 2]);
  });

  it('computes the losers-bracket round count as 2*winnersRoundCount - 2', () => {
    const rounds = raceDoubleEliminationBracketPhase(16, 1, baseConfig); // numRounds=4
    const losersRounds = rounds.filter((round) => round.bracket === 'losers');
    expect(losersRounds).toHaveLength(2 * 4 - 2);
  });

  it('interleaves exactly 1 LB round after WB round 0 and the WB final, 2 between every other pair', () => {
    const rounds = raceDoubleEliminationBracketPhase(16, 1, baseConfig);
    const groups: number[] = [];
    let currentGroup = 0;
    for (const round of rounds) {
      if (round.bracket === 'winners') {
        if (currentGroup > 0 || groups.length === 0) groups.push(currentGroup);
        currentGroup = 0;
      } else if (round.bracket === 'losers') {
        currentGroup += 1;
      }
    }
    groups.push(currentGroup); // trailing group after the last WB round
    groups.shift(); // drop the placeholder pushed before WB round 0 ever ran
    expect(groups).toEqual([1, 2, 2, 1]);
  });

  it('the grand final round is bracket:"grand-final" seeded with numGames:1', () => {
    const rounds = raceDoubleEliminationBracketPhase(16, 1, baseConfig);
    const grandFinal = rounds[rounds.length - 1];
    expect(grandFinal.bracket).toBe('grand-final');
    expect(grandFinal.numGames).toBe(1);
    expect(grandFinal.isFinal).toBe(true);
  });
});

describe('sharedFinalDoubleEliminationBracketPhase', () => {
  const baseConfig: SharedFinalDoubleEliminationConfig = {
    roomSize: FFA_ROOM_SIZE,
    finalSize: 8,
    lbQualifiers: 2,
    finalsGames: 3,
  };

  it('throws when lbQualifiers < 1', () => {
    expect(() =>
      sharedFinalDoubleEliminationBracketPhase(37, 1, { ...baseConfig, lbQualifiers: 0 }),
    ).toThrow();
  });

  it('throws when finalSize - lbQualifiers < 1', () => {
    expect(() =>
      sharedFinalDoubleEliminationBracketPhase(37, 1, { ...baseConfig, lbQualifiers: 8 }),
    ).toThrow();
  });

  it('WB round 0 uses ordinary self-correcting distributeRoomsWithBye — never concentrated', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, {
      ...baseConfig,
      oddCountStrategy: 'bye',
    });
    const wb0 = rounds[0];
    expect(wb0.bracket).toBe('winners');
    expect(wb0.byeCount).toBeLessThanOrEqual(1);
  });

  it('defers losers-bracket round creation, so not every WB round gets its own LB round', () => {
    // FFA 32p, WBQ=6/LBQ=2 -- the legacy-flagged anchor case that originally
    // surfaced the "wasted LB round" bug this deferral logic fixes.
    const rounds = sharedFinalDoubleEliminationBracketPhase(32, 1, baseConfig);
    const winnersRounds = rounds.filter((round) => round.bracket === 'winners');
    const losersRounds = rounds.filter((round) => round.bracket === 'losers');
    expect(winnersRounds.length).toBeGreaterThan(0);
    expect(losersRounds.length).toBeGreaterThan(0);
    expect(losersRounds.length).toBeLessThan(winnersRounds.length);
  });

  it('the shared Final is always a single literal room, never split, even for a large finalSize', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, { ...baseConfig, finalSize: 20 });
    const final = rounds[rounds.length - 1];
    expect(final.isFinal).toBe(true);
    expect(final.rooms).toEqual([20]);
  });

  it('every winners-bracket round routes its losers to a real losers-bracket round or the Final', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, baseConfig);
    const winnersRounds = rounds.filter((round) => round.bracket === 'winners');
    for (const round of winnersRounds) {
      expect(round.losersTo).not.toBeNull();
      expect(round.losersTo).toBeGreaterThanOrEqual(0);
    }
  });

  it('never lets more than 2 consecutive WB rounds pass before an LB round is played, across a range of seed totals', () => {
    for (let seedTotal = 10; seedTotal <= 100; seedTotal += 1) {
      const rounds = sharedFinalDoubleEliminationBracketPhase(seedTotal, 1, baseConfig);
      expect(maxConsecutiveWbRounds(rounds)).toBeLessThanOrEqual(2);
    }
  });

  it('every losers-bracket round it creates is a genuine cut -- never a no-op that just lets the whole pending pool through', () => {
    for (let seedTotal = 10; seedTotal <= 100; seedTotal += 1) {
      const rounds = sharedFinalDoubleEliminationBracketPhase(seedTotal, 1, baseConfig);
      for (const round of rounds.filter((entry) => entry.bracket === 'losers')) {
        const players = round.rooms.reduce((sum, size) => sum + size, 0) + round.byeCount;
        expect(round.advTotal).toBeLessThan(players);
        expect(round.advTotal).toBeGreaterThanOrEqual(baseConfig.lbQualifiers);
      }
    }
  });

  it('explicitTargets bypasses the automatic geometric-decay curve for the WB round count/targets', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, {
      ...baseConfig,
      explicitTargets: [28, 20],
    });
    const winnersRounds = rounds.filter((round) => round.bracket === 'winners');
    expect(winnersRounds).toHaveLength(2);
    expect(winnersRounds.map((round) => round.advTotal)).toEqual([28, 20]);
    // The LB-scheduling loop (unaffected by explicitTargets) still routes every
    // WB round's drops to a real losers-bracket round or the Final.
    for (const round of winnersRounds) {
      expect(round.losersTo).not.toBeNull();
    }
  });

  it('regression: the real 19-player tournament that surfaced this bug now gets its first LB round after WB round 2, not WB round 3', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(19, 1, baseConfig);
    const winnersRounds = rounds.filter((round) => round.bracket === 'winners');
    const losersRounds = rounds.filter((round) => round.bracket === 'losers');
    expect(winnersRounds).toHaveLength(6);
    expect(maxConsecutiveWbRounds(rounds)).toBe(2);
    // The forced first LB round lands at exactly 6 players -- matching the
    // organiser's own stated comfort level ("it is fine to play rooms with
    // 6 players at that stage"), even though FFA_ROOM_SIZE.min is also 6.
    expect(losersRounds[0].rooms.reduce((sum, size) => sum + size, 0)).toBe(6);
  });
});

describe('sharedFinalDoubleEliminationBracketPhase -- seatable losers-bracket rounds', () => {
  const TEAM_2V2V2V2: RoomSize = { min: 3, max: 4, ideal: 4 };
  const TEAM_3V3V3: RoomSize = { min: 2, max: 3, ideal: 3 };
  const config = (lbQualifiers: number, extra: Partial<SharedFinalDoubleEliminationConfig> = {}) => ({
    roomSize: TEAM_2V2V2V2,
    finalSize: 4,
    lbQualifiers,
    finalsGames: 1,
    ...extra,
  });
  const phase = (teams: number, lbQualifiers: number, extra?: Partial<SharedFinalDoubleEliminationConfig>) =>
    sharedFinalDoubleEliminationBracketPhase(teams, 1, config(lbQualifiers, extra));
  const losers = (rounds: TournamentRound[]) => rounds.filter((round) => round.bracket === 'losers');
  const players = (rounds: TournamentRound[]) => rounds.map((round) => round.players);

  it('12 teams, default settings: no losers round of 5, exact round list', () => {
    // Winners targets 9, 7, 6, 4, 3. The drop of 3 after round 1 can't be cut, so it waits.
    // After the second winners round 3 + 2 = 5 would be a losers round of 5 (not seatable),
    // there is no earlier losers round, and the deferral limit is reached, so the second
    // winners target moves 7 -> 8 (nearest value that seats 3 + 1 = 4 and the next round 8).
    // Then 6, 4, 3 follow the old curve and each losers round (4, 4, 4, 4) is a full room.
    const rounds = phase(12, 2);
    expect(losers(rounds).some((round) => round.players === 5)).toBe(false);
    expect(players(rounds)).toEqual([12, 9, 4, 8, 4, 6, 4, 4, 4, 3, 4, 4]);
    expect(rounds[1].advTotal).toBe(8);
  });

  it('23 teams, default settings: the last losers round of 5 becomes 6', () => {
    const rounds = phase(23, 2);
    expect(losers(rounds).every((round) => isSeatable(round.players, TEAM_2V2V2V2))).toBe(true);
    expect(losers(rounds).at(-1)?.players).toBe(6);
  });

  it('lever 1: changes the previous losers round survivor target (10 teams, 1 LB qualifier)', () => {
    // The first losers round (round 3) had 4 players cutting to 3; with the next winners drop of 2
    // that left 5. It now cuts to 2, so the next round seats 2 + 2 = 4.
    const rounds = phase(10, 1);
    expect(players(rounds)).toEqual([10, 7, 4, 6, 4, 4, 4, 4]);
    expect(rounds[2]).toMatchObject({ bracket: 'losers', advTotal: 2 });
  });

  it('lever 2: defers the first losers round to the next winners round (18 teams, 1 LB qualifier)', () => {
    // The drop of 5 after round 1 used to become a losers round of 5; it now waits and joins
    // the next drop: 5 + 3 = 8 players in round 3.
    const rounds = phase(18, 1);
    expect(rounds[1].bracket).toBe('winners');
    expect(losers(rounds)[0]).toMatchObject({ roundNum: 3, players: 8 });
    expect(losers(rounds).some((round) => round.players === 5)).toBe(false);
  });

  it('lever 3: moves the latest winners target for the first losers round (12 teams, 1 LB qualifier)', () => {
    // Winners targets 9, 7, 6, 4 (lb 1): first losers round would hold 3 + 2 = 5, so 7 -> 8.
    const rounds = phase(12, 1);
    expect(rounds.filter((round) => round.bracket === 'winners').map((round) => round.advTotal)).toEqual([
      9, 8, 6, 4, 3,
    ]);
    expect(players(rounds)).toEqual([12, 9, 4, 8, 4, 6, 4, 4, 4, 4]);
  });

  it('keeps organiser-supplied winners targets unchanged', () => {
    const rounds = phase(12, 1, { explicitTargets: [9, 7, 6, 4, 3] });
    expect(rounds.filter((round) => round.bracket === 'winners').map((round) => round.advTotal)).toEqual([
      9, 7, 6, 4, 3,
    ]);
  });

  describe('property: every planned count can be seated', () => {
    // Entry counts from two rooms up to 60 (so 31, 37, 43 and 53 are all covered), every
    // LB-qualifier count the Final allows, default and overridden Final size.
    const cases: Array<[string, RoomSize, number[]]> = [
      ['team-2v2v2v2', TEAM_2V2V2V2, [4, 3]],
      ['team-3v3v3', TEAM_3V3V3, [3, 2]],
      ['ffa-individual', FFA_ROOM_SIZE, [8, 6]],
    ];
    // No lever seats these two FFA plans (a Final of 6 with 3 LB qualifiers: the
    // first losers round holds 5 + 5 = 10, and 7/8 are the only seatable targets
    // for the winners round before it). They keep today's [5,5] split; reported to the planner.
    const KNOWN_UNSEATABLE_FFA = new Set(['final 6, lb 3: 17', 'final 6, lb 3: 18']);
    it.each(cases)('%s', (_name, roomSize, finalSizes) => {
      for (const finalSize of finalSizes) {
        for (let lbQualifiers = 1; lbQualifiers <= 3 && lbQualifiers < finalSize; lbQualifiers += 1) {
          for (let teams = 2 * roomSize.ideal; teams <= 60; teams += 1) {
            const label = `${teams} entrants, final ${finalSize}, lb ${lbQualifiers}`;
            let rounds: TournamentRound[];
            try {
              rounds = sharedFinalDoubleEliminationBracketPhase(teams, 1, {
                roomSize,
                finalSize,
                lbQualifiers,
                finalsGames: 1,
              });
            } catch (error) {
              // Only the existing "can't route every drop" refusal is allowed to remain.
              expect(String(error), label).toContain('could not route');
              continue;
            }
            expect(rounds.at(-1)?.isFinal, label).toBe(true);
            const unseatable = rounds.slice(1, -1).filter((round) => !isSeatable(round.players, roomSize));
            if (!KNOWN_UNSEATABLE_FFA.has(`final ${finalSize}, lb ${lbQualifiers}: ${teams}`)) {
              expect(unseatable, label).toEqual([]);
            }
          }
        }
      }
    });
  });
});
