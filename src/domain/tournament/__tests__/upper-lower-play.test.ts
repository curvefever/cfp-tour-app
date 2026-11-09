import { describe, expect, it } from 'vitest';
import { deriveRoomSize, getGameFormat } from '../formats';
import { roundsBeforeBracket } from '../pooling-rounds';
import { computeRankings } from '../rankings';
import { createDefaultSetup } from '../state-defaults';
import type { TournamentState } from '../types';
import { upperLowerEntry, upperLowerFinalSize, upperLowerGraphText } from '../upper-lower';
import {
  STRATEGIES,
  drawsOf,
  expectEveryUnitRankedOnce,
  playColumns,
  playDependency,
  playToBracketEntry,
} from './dependency-play-fixtures';
import { withoutDependencyPlay } from './qual-waterfall';
import { generated } from './test-fixtures';

/**
 * The derived graph text played by the real engine: generated as a Custom bracket, played to the Final in the five
 * press orders. Every press lists every unit once in Rankings; the Final has two halves of a room; the draws are
 * column play's whatever the order; the units out are ranked by how far they got.
 */

type Setup = Parameters<typeof generated>[1];

interface PlayCase {
  label: string;
  count: number;
  setup: Setup;
}

const ffa = (count: number): PlayCase => ({
  label: `FFA qualification table, ${count}`,
  count,
  setup: { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' },
});
const teams = (gameFormat: 'team-2v2v2v2' | 'team-2v2v2v2v2' | 'team-2v2v2', count: number): PlayCase => ({
  label: `${gameFormat.slice(5)} qualification table, ${count}`,
  count,
  setup: { gameFormat, poolingPhase: 'qual-table' },
});
const headToHead = (
  poolingPhase: 'qual-table' | 'swiss',
  gameFormat: 'individual-1v1' | 'team-2v2',
  count: number,
): PlayCase => ({
  label: `${gameFormat === 'individual-1v1' ? '1v1' : '2v2'} ${poolingPhase === 'swiss' ? 'Swiss' : 'qualification table'}, ${count}`,
  count,
  setup: { gameFormat, poolingPhase, oddCountStrategy: 'bye' },
});

const CASES: PlayCase[] = [
  ...[12, 13, 16, 23, 24, 25, 27, 28, 29, 31, 32, 37, 43, 53].map(ffa),
  ...[8, 13, 17, 19, 23].map((count) => teams('team-2v2v2v2', count)),
  ...[17, 18, 19].map((count) => teams('team-2v2v2v2v2', count)),
  ...[9, 10, 11, 13].map((count) => teams('team-2v2v2', count)),
  ...[7, 9, 16].map((count) => headToHead('qual-table', 'individual-1v1', count)),
  ...[7, 9, 16].map((count) => headToHead('swiss', 'individual-1v1', count)),
  ...[8, 11].map((count) => headToHead('swiss', 'team-2v2', count)),
  {
    label: '1v1 Swiss with a fixed draw, 11',
    count: 11,
    setup: {
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      oddCountStrategy: 'bye',
      drawPublication: 'fixed',
    },
  },
  ...[11, 13, 15, 16].map((count): PlayCase => ({
    label: `4v4 group stage, fair cut, ${count}`,
    count,
    setup: {
      gameFormat: 'team-4v4',
      poolingPhase: 'group-stage',
      groupSize: '4',
      groupExit: 'fair-cut',
      oddCountStrategy: 'bye',
    },
  })),
];

/** The tournament as the derived graph generates it, in column play, started. */
function build(testCase: PlayCase): { state: TournamentState; first: number; entry: number } {
  const setup = createDefaultSetup({ scheduleLogic: 'waterfall-bracket', ...testCase.setup });
  const roomSize = deriveRoomSize(getGameFormat(setup.gameFormat) as never);
  const first = roundsBeforeBracket(setup, testCase.count) + 1;
  const entry = upperLowerEntry(testCase.count, null, roomSize);
  if (!entry.ok) throw new Error(entry.message);
  const kind = setup.poolingPhase === 'group-stage' ? 'groups' : 'qual';
  const waterfallGraph = upperLowerGraphText(entry.entry, roomSize, first, kind);
  const state = generated(testCase.count, {
    ...testCase.setup,
    scheduleLogic: 'waterfall-bracket',
    waterfallGraph,
  });
  return { state: withoutDependencyPlay({ ...state, started: true }), first, entry: entry.entry };
}

/** The ranks of the units a round eliminated, by the round's name (a pooling round has none). */
function ranksOutAt(state: TournamentState, label: string | null): number[] {
  return (computeRankings(state)?.eliminatedList ?? [])
    .filter((unit) => (label === null ? !unit.round.isWaterfall : unit.round.customLabel === label))
    .map((unit) => unit.rank as number);
}

/** Rounds from the best place out to the worst: the later the round, the better the place, a ranking room below its column. */
function expectedOrder(first: number, fourRooms: boolean): Array<string | null> {
  return fourRooms
    ? [
        'Semi-Final B',
        `Round ${first + 2} - Lower`,
        `Round ${first + 2} - Ranking`,
        `Round ${first + 1} - Lower`,
        `Round ${first + 1} - Ranking`,
        `Round ${first} - Lower`,
        null,
      ]
    : ['Semi-Final', `Round ${first + 1} - Ranking`, `Round ${first} - Lower`, null];
}

/**
 * The organiser's rule for a ranking room: its units are out from the round before, so they rank below anyone
 * eliminated in the other rounds of the room's own column. That rests on the validator playing the ranking rooms
 * first in their column (Rankings orders the eliminated by round order), whatever order the Bracket lists them in.
 */
function expectRankingRoomsBelowTheirColumn(state: TournamentState): void {
  const columns = new Map<number, { ranking: number[]; others: number[] }>();
  for (const unit of computeRankings(state)?.eliminatedList ?? []) {
    const { round } = unit;
    if (!round.isWaterfall || round.waterfallColumn === undefined) continue;
    const column = columns.get(round.waterfallColumn) ?? { ranking: [], others: [] };
    (round.waterfallRanking ? column.ranking : column.others).push(unit.rank as number);
    columns.set(round.waterfallColumn, column);
  }
  for (const [number, { ranking, others }] of columns) {
    if (ranking.length > 0 && others.length > 0) {
      expect(Math.min(...ranking), `column ${number}`).toBeGreaterThan(Math.max(...others));
    }
  }
}

const namesOf = (state: TournamentState, index: number): string[] =>
  (state.assignments[index] ?? []).map((entry) => entry.name);

/**
 * At the end of the walk: a ranking room holds exactly the units of the Lower round before it that did not go on (the
 * ones below the top half), and none of its units is in any later round.
 */
function expectRankingRoomsFedByTheLowerBefore(state: TournamentState): number {
  let checked = 0;
  state.rounds.forEach((round, index) => {
    const number = /^Round ([0-9]+) - Ranking$/.exec(round.customLabel ?? '')?.[1];
    if (!round.waterfallRanking || number === undefined) return;
    const lower = state.rounds.findIndex(
      (other) => other.customLabel === `Round ${Number(number) - 1} - Lower`,
    );
    expect(lower, `the Lower round before ${round.customLabel}`).toBeGreaterThanOrEqual(0);
    const later = new Set(
      state.rounds.flatMap((other, at) =>
        at > lower && at !== index && other.isWaterfall ? namesOf(state, at) : [],
      ),
    );
    const out = namesOf(state, lower).filter((name) => !later.has(name));
    expect([...namesOf(state, index)].sort(), round.customLabel).toEqual([...out].sort());
    const inLaterRounds = state.rounds.flatMap((_, at) => (at > index ? namesOf(state, at) : []));
    for (const name of namesOf(state, index)) expect(inLaterRounds, name).not.toContain(name);
    checked += 1;
  });
  return checked;
}

describe.each(CASES)('$label', (testCase) => {
  const { state: start, first, entry } = build(testCase);
  const roomSize = deriveRoomSize(getGameFormat(start.gameFormat) as never);
  const entered = playToBracketEntry(start);
  const reference = drawsOf(playColumns(entered));
  const expectRanked = (state: TournamentState) => {
    expectEveryUnitRankedOnce(state, testCase.count);
    return state;
  };

  it('generates the derived graph, and plays column play to the Final', () => {
    expect(start.cfg.qualAdv).toBe(entry);
    const last = reference.rooms.length - 1;
    expect(reference.rooms[last].reduce((total, size) => total + size, 0)).toBe(
      upperLowerFinalSize(roomSize),
    );
  });

  it.each(Object.entries(STRATEGIES))(
    "%s: column play's draws, every unit once after every press, the units out ranked by how far they got",
    (_name, strategy) => {
      const played = playDependency(entered, strategy, (state) => {
        expectRankingRoomsBelowTheirColumn(expectRanked(state));
        return state;
      });
      expect(drawsOf(played)).toEqual(reference);
      expectRanked(played);
      // Every ranking room of the schedule was checked (none skipped for a name the check does not read).
      expect(expectRankingRoomsFedByTheLowerBefore(played)).toBe(
        played.rounds.filter((round) => round.waterfallRanking).length,
      );
      // The units the pooling phase cut are out before the bracket starts.
      expect(ranksOutAt(played, null)).toHaveLength(testCase.count - entry);
      const finalIndex = played.rounds.length - 1;
      expect(played.assignments[finalIndex]).toHaveLength(upperLowerFinalSize(roomSize));
      const groups = expectedOrder(first, entry > 2 * roomSize.max)
        .map((label) => ranksOutAt(played, label))
        .filter((ranks) => ranks.length > 0);
      groups.slice(1).forEach((ranks, index) => {
        expect(Math.max(...groups[index])).toBeLessThan(Math.min(...ranks));
      });
    },
  );
});
