import { describe, expect, it } from 'vitest';
import { getAllTies } from '../advancement';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { removeRosterUnit } from '../mutations';
import { computeRankings } from '../rankings';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { goBack } from '../waterfall-steps';
import { swissRoutesItsStandings } from '../pooling';
import { rosterKeys } from '../roster';
import { finalsMatchOf, serializeWaterfallDraft, waterfallDraftFromRounds } from '../waterfall-draft';
import {
  STRATEGIES,
  drawsOf,
  indexOf,
  onlyFinalInPlay,
  playColumns,
  playDependency,
  pressed,
  resolveEveryTie,
  scoreRound,
} from './dependency-play-fixtures';
import { scoredAlike, withDependencyPlay } from './qual-waterfall';
import {
  SWISS_LINELESS_GRAPH as LINELESS,
  SWISS_QUAL_GRAPH as GRAPH,
  atEntry,
  firstBracketIndex,
  swiss,
  toSwissExit,
} from './swiss-source-fixtures';
import { generated } from './test-fixtures';

/**
 * A Swiss routes its final standings through a `Qual` line exactly as a qualification table does: ranks 1-4 to the Upper
 * round and 5-8 to the Lower one, everyone else out. Head-to-head formats only, so the graph has rooms of two.
 */

const FORMATS = [
  { label: '1v1', setup: { gameFormat: 'individual-1v1' as const } },
  { label: '2v2', setup: { gameFormat: 'team-2v2' as const, teamScoringRule: ONE_SCORE_PER_TEAM } },
];
const COUNTS = [9, 11, 16];

const comparable = (state: TournamentState): TournamentState => ({
  ...state,
  pendingBracketSeeds: Object.fromEntries(
    Object.entries(state.pendingBracketSeeds)
      .filter(([, seeds]) => seeds.length > 0)
      .map(([destination, seeds]) => [destination, [...seeds].sort((a, b) => a.name.localeCompare(b.name))]),
  ),
});

/** Every unit once across the Rankings lists. */
function rankedOnce(state: TournamentState, count: number): void {
  const rankings = computeRankings(state);
  const names = [
    ...(rankings?.stillActive ?? []),
    ...(rankings?.finalists ?? []),
    ...(rankings?.eliminatedList ?? []),
    ...(rankings?.dnfList ?? []),
  ].map((unit) => unit.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toHaveLength(count);
}

describe.each(FORMATS.flatMap((format) => COUNTS.map((count) => ({ ...format, count }))))(
  'a Swiss with a Qual line: $label at $count',
  ({ setup, count }) => {
    const start = swiss(count, setup);
    const last = firstBracketIndex(start) - 1;

    it('puts the routing on the last Swiss round only, and derives Advance to bracket from the line', () => {
      expect(start.rounds[last].isSwiss).toBe(true);
      const routes = start.rounds[last].standingsRoutes;
      const [upper, lower] = [indexOf(start, 'U'), indexOf(start, 'L')];
      expect(routes).toEqual([upper, upper, upper, upper, lower, lower, lower, lower]);
      expect(start.rounds.slice(0, last).every((round) => round.standingsRoutes === undefined)).toBe(true);
      expect(start.cfg.qualAdv).toBe(8);
    });

    it('draws the entry rounds from the standings at the exit, and puts nobody else in the bracket', () => {
      const entry = atEntry(start);
      const seated = ['U', 'L'].flatMap((label) =>
        entry.assignments[indexOf(entry, label)].map((unit) => unit.name),
      );
      expect(seated).toHaveLength(8);
      expect(new Set(seated).size).toBe(8);
      expect(entry.rounds[last].standingsExitOrder).toHaveLength(count);
    });

    it.each(Object.entries(STRATEGIES))(
      "%s: the five press orders give column play's draws",
      (_name, strategy) => {
        const entry = atEntry(start);
        const reference = drawsOf(playColumns(entry));
        const played = playDependency(entry, strategy, (state) => {
          rankedOnce(state, count);
          return state;
        });
        expect(drawsOf(played)).toEqual(reference);
        rankedOnce(played, count);
      },
    );

    it('Previous goes back into the last Swiss round, and Next Round draws the same bracket again', () => {
      const played = withDependencyPlay(atEntry(start));
      const pooling = goBack(played);
      expect(pooling.curRound).toBe(last);
      expect(comparable(pressed(pooling))).toEqual(comparable(played));
    });

    it('a save of the unchanged graph succeeds before the exit and at every press', () => {
      const text = start.settings?.waterfallGraph ?? '';
      const atExit = toSwissExit(start);
      const before = applyWaterfallGraphEdit(atExit, text);
      expect(before.ok ? '' : before.error).toBe('');
      let state = withDependencyPlay(atEntry(start));
      let saves = 0;
      for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
        const saved = applyWaterfallGraphEdit(state, text);
        expect(saved.ok ? '' : saved.error).toBe('');
        if (saved.ok) expect(saved.state.rounds).toEqual(state.rounds);
        const unscored = state.rounds.flatMap((round, index) =>
          index >= firstBracketIndex(state) && !round.isFinal ? [index] : [],
        );
        for (const index of unscored) {
          if (state.assignments[index]?.length) state = scoreRound(state, index);
        }
        state = pressed(state);
        saves += 1;
      }
      expect(saves).toBeGreaterThan(2);
    });
  },
);

describe('ties at a band boundary and at the cut', () => {
  it('11 units: a tie across the 4/5 boundary and one at the 8/9 cut are asked for, then resolved', () => {
    const state = toSwissExit(swiss(11), (current, index) => scoredAlike({ ...current, curRound: index }));
    const ties = getAllTies(state, state.curRound);
    expect(Object.keys(ties)).toEqual(expect.arrayContaining(['qual-band-1', 'qual-cutoff']));
    const blocked = advanceTournamentRound(state);
    expect(blocked.status).not.toBe('advanced');
    const advanced = pressed(resolveEveryTie(state, state.curRound));
    const seated = ['U', 'L'].flatMap((label) =>
      advanced.assignments[indexOf(advanced, label)].map((unit) => unit.name),
    );
    expect(new Set(seated).size).toBe(8);
  });

  it.each([9, 16])('%i units: the tie at the cut is asked for and resolved', (count) => {
    const state = toSwissExit(swiss(count), (current, index) => scoredAlike({ ...current, curRound: index }));
    expect(Object.keys(getAllTies(state, state.curRound))).toContain('qual-cutoff');
    expect(advanceTournamentRound(state).status).not.toBe('advanced');
    const advanced = pressed(resolveEveryTie(state, state.curRound));
    expect(advanced.assignments[indexOf(advanced, 'U')]).toHaveLength(4);
    expect(advanced.assignments[indexOf(advanced, 'L')]).toHaveLength(4);
  });
});

describe('other Swiss settings', () => {
  it('a fixed-draw Swiss is routed by the standings the same way', () => {
    const fixed = swiss(11, { drawPublication: 'fixed' });
    expect(fixed.rounds[firstBracketIndex(fixed) - 1].fixedRoomAssignments).toBeDefined();
    const entry = atEntry(fixed);
    expect(entry.assignments[indexOf(entry, 'U')]).toHaveLength(4);
    expect(entry.assignments[indexOf(entry, 'L')]).toHaveLength(4);
    const played = playDependency(entry, STRATEGIES['all at once']);
    expect(drawsOf(played)).toEqual(drawsOf(playColumns(entry)));
    rankedOnce(played, 11);
  });

  it('9 units have a bye in the last round and are routed all the same', () => {
    const start = swiss(9);
    const last = firstBracketIndex(start) - 1;
    expect(start.rounds[last].byeCount).toBe(1);
    const entry = atEntry(start);
    expect(entry.assignments[indexOf(entry, 'U')]).toHaveLength(4);
    expect(entry.assignments[indexOf(entry, 'L')]).toHaveLength(4);
  });

  it('non-counting rounds leave the standings of the counting ones to route', () => {
    const start = swiss(11, { nonCountingRounds: '1' });
    const entry = atEntry(start);
    expect(entry.assignments[indexOf(entry, 'U')]).toHaveLength(4);
    expect(entry.assignments[indexOf(entry, 'L')]).toHaveLength(4);
    const played = playDependency(entry, STRATEGIES['all at once']);
    rankedOnce(played, 11);
  });
});

describe('changing the Qual line during the Swiss', () => {
  const swapped = GRAPH.replace('Qual: 1-4->U, 5-8->L', 'Qual: 1-4->L, 5-8->U');

  it('routes the standings the new way: the units that went to U now go to L', () => {
    const start = swiss(11);
    const atExit = toSwissExit(start);
    const saved = applyWaterfallGraphEdit(atExit, swapped);
    expect(saved.ok ? '' : saved.error).toBe('');
    if (!saved.ok) return;
    const last = firstBracketIndex(start) - 1;
    expect(saved.state.rounds[last].standingsRoutes).toEqual(
      [4, 4, 4, 4, 3, 3, 3, 3].map((_, index) => (index < 4 ? indexOf(start, 'L') : indexOf(start, 'U'))),
    );
    expect(saved.state.cfg.qualAdv).toBe(8);
    const original = pressed(atExit);
    const changed = pressed(saved.state);
    const upperBefore = original.assignments[indexOf(original, 'U')].map((unit) => unit.name).sort();
    const lowerAfter = changed.assignments[indexOf(changed, 'L')].map((unit) => unit.name).sort();
    expect(lowerAfter).toEqual(upperBefore);
  });

  it('refuses a line that sends more ranks on than there are units', () => {
    const atExit = toSwissExit(swiss(9));
    const tooMany = GRAPH.replace('5-8->L', '5-10->L');
    const saved = applyWaterfallGraphEdit(atExit, tooMany);
    expect(saved.ok).toBe(false);
  });
});

describe('a Swiss with no Qual line stays a Custom bracket with one entry round', () => {
  it('has no routing on its Swiss rounds and reads "Advance to bracket" from the form', () => {
    const state = swiss(11, { qualAdv: '8' }, LINELESS);
    expect(state.rounds.every((round) => round.standingsRoutes === undefined)).toBe(true);
    expect(state.cfg.qualAdv).toBe(8);
    expect(state.rounds[firstBracketIndex(state)].rooms).toEqual([2, 2, 2, 2]);
  });
});

describe('wording that names the Swiss', () => {
  it('Next Round blocked by too few ranked units says "Swiss standings", not the qualification table', () => {
    let state = toSwissExit(swiss(9));
    state = removeRosterUnit(removeRosterUnit(state, 'P1'), 'P2');
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('blocked');
    const message = 'message' in result ? result.message : '';
    expect(message).toContain('the Swiss standings rank 7 unit(s)');
    expect(message).not.toContain('qualification table');
  });

  it('a qualification table keeps its own wording', () => {
    const table = generated(9, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      gameFormat: 'individual-1v1',
      oddCountStrategy: 'bye',
      waterfallGraph: GRAPH,
    });
    let state = toSwissExit({ ...table, started: true });
    state = removeRosterUnit(removeRosterUnit(state, 'P1'), 'P2');
    const result = advanceTournamentRound(state);
    expect('message' in result ? result.message : '').toContain('the qualification table ranks 7 unit(s)');
  });
});

/** The text "Edit graph" opens on: the graph read back off the rounds as they stand (`RunningWaterfallPanel`). */
function editedText(state: TournamentState): string {
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  return serializeWaterfallDraft(
    waterfallDraftFromRounds(state.rounds, {
      rankCount: rosterKeys(state.players).length,
      finalsMatch: finalsMatchOf(finalsGames, finalsBestOf),
    }),
  );
}

describe('"Edit graph" on a Swiss with a Qual line', () => {
  const start = swiss(11);
  const states = [
    ['during the Swiss', toSwissExit(start)],
    ['after the exit', withDependencyPlay(atEntry(start))],
  ] as const;

  it.each(states)(
    '%s: the graph is read back with its Qual routes, and saving it changes nothing',
    (_when, state) => {
      const draft = waterfallDraftFromRounds(state.rounds, { rankCount: 11 });
      expect(draft.afterSwiss).toBe(true);
      expect(draft.qualRoutes).toEqual(['U', 'U', 'U', 'U', 'L', 'L', 'L', 'L', null, null, null]);
      const text = editedText(state);
      expect(text).toContain('Qual: 1-4->U, 5-8->L');
      const saved = applyWaterfallGraphEdit(state, text);
      expect(saved.ok ? '' : saved.error).toBe('');
      if (!saved.ok) return;
      expect(saved.state.rounds).toEqual(state.rounds);
      expect(saved.state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes).toEqual(
        state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes,
      );
    },
  );
});

describe('"Edit graph" on a Swiss with no Qual line', () => {
  const start = swiss(11, { qualAdv: '8' }, LINELESS);
  const states = [
    ['during the Swiss', toSwissExit(start)],
    ['after the exit', withDependencyPlay(atEntry(start))],
  ] as const;

  it.each(states)('%s: no Qual source is read or written, and a save changes nothing', (_when, state) => {
    expect(waterfallDraftFromRounds(state.rounds, { rankCount: 11 }).qualRoutes).toBeNull();
    const text = editedText(state);
    expect(text).not.toContain('Qual');
    const saved = applyWaterfallGraphEdit(state, text);
    expect(saved.ok ? '' : saved.error).toBe('');
    if (!saved.ok) return;
    expect(saved.state.rounds).toEqual(state.rounds);
    expect(saved.state.rounds.some((round) => round.standingsRoutes !== undefined)).toBe(false);
  });
});

describe('swissRoutesItsStandings', () => {
  it('is true for a Swiss with a Qual line, false for one without and for a qualification table', () => {
    expect(swissRoutesItsStandings(swiss(11))).toBe(true);
    expect(swissRoutesItsStandings(swiss(11, { qualAdv: '8' }, LINELESS))).toBe(false);
    const table = generated(11, {
      gameFormat: 'individual-1v1',
      oddCountStrategy: 'bye',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      waterfallGraph: GRAPH,
    });
    expect(swissRoutesItsStandings(table)).toBe(false);
  });
});
