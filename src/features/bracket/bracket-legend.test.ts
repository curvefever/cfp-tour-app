import { describe, expect, it } from 'vitest';
import { buildState } from '../../domain/tournament/__tests__/play-through';
import { QUAL_GRAPH, buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { WATERFALL_EXAMPLES } from '../../domain/tournament/waterfall-examples';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { withEarlierCutRule } from '../../domain/tournament/__tests__/play-through';
import { bracketLegend } from './bracket-legend';

function generated(count: number, setup: Partial<PersistedSetup>, teams = false): TournamentState {
  const state = buildState({
    label: `${count}`,
    count,
    teams,
    setup: { gameFormat: 'ffa-individual', ...setup },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

const names = (state: TournamentState) => bracketLegend(state).rows.map((row) => row.name);

describe('bracketLegend', () => {
  it.each([31, 37, 43, 53])(
    'a qualification table into single elimination with lucky losers (%i players): through, lucky loser, out, undecided',
    (count) => {
      const legend = bracketLegend(
        generated(count, { scheduleLogic: 'single-elimination', poolingPhase: 'qual-table', qualAdv: '24' }),
      );
      expect(legend.rows.map((row) => row.name)).toEqual(['Through', 'Lucky loser', 'Out', 'Undecided']);
      expect(legend.rows[1]).toMatchObject({ tone: 'green', star: true });
      expect(legend.luckyLosers).toBe(true);
    },
  );

  it('has no lucky-loser row or paragraph when no round has lucky-loser spots (16 players, no pooling)', () => {
    const legend = bracketLegend(
      generated(16, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
    );
    expect(legend.rows.map((row) => row.name)).toEqual(['Through', 'Out', 'Undecided']);
    expect(legend.luckyLosers).toBe(false);
  });

  it('shows the losers bracket (purple) in double elimination and nothing about Kings Valley or destinations', () => {
    const legend = bracketLegend(
      generated(16, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
        oddCountStrategy: 'bye',
      }),
    );
    expect(legend.rows.map((row) => row.name)).toEqual(['Through', 'Out', 'Undecided', 'Losers bracket']);
    expect(legend.rows.at(-1)?.tone).toBe('purple');
  });

  it('shows Promoted, Stays and Demoted (green, yellow, orange) only in Kings Valley', () => {
    const legend = bracketLegend(
      generated(
        12,
        { gameFormat: 'team-2v2v2v2', scheduleLogic: 'kings-valley', poolingPhase: 'none' },
        true,
      ),
    );
    expect(legend.rows.slice(-3).map((row) => [row.name, row.tone])).toEqual([
      ['Promoted', 'green'],
      ['Stays', 'yellow'],
      ['Demoted', 'orange'],
    ]);
    expect(
      names(
        generated(37, { scheduleLogic: 'single-elimination', poolingPhase: 'qual-table', qualAdv: '24' }),
      ),
    ).not.toContain('Promoted');
  });

  it.each([31, 37, 43, 53])(
    'a Qual source with two destinations (%i players) has the generic yellow row and no purple row',
    (count) => {
      const legend = bracketLegend(buildQualWaterfall(count, QUAL_GRAPH));
      expect(legend.rows.filter((row) => row.tone === 'yellow')).toEqual([
        expect.objectContaining({
          name: 'Through to another round',
          meaning: "A second group of places; a room's arrow shows where",
        }),
      ]);
      expect(legend.rows.some((row) => row.tone === 'purple')).toBe(false);
    },
  );

  it('a waterfall with three destinations has a generic yellow and purple row, and no Losers bracket row', () => {
    const graph = `
ROUNDS:
R1 = 2x8
R1C = 8
R1D = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C, 25-32->R1D
R1.A: 1-2->Final, 3-8->eliminated
R1.B: 1-2->Final, 3-8->eliminated
R1C: 1-2->Final, 3-8->eliminated
R1D: 1-2->Final, 3-8->eliminated
`;
    const legend = bracketLegend(buildQualWaterfall(40, graph));
    const rows = legend.rows.map((row) => [row.tone, row.name]);
    expect(rows).toContainEqual(['yellow', 'Through to another round']);
    expect(rows).toContainEqual(['purple', 'Through to a third round']);
    expect(legend.rows.find((row) => row.tone === 'purple')?.meaning).toBe('A third group of places');
    expect(legend.rows.map((row) => row.name)).not.toContain('Losers bracket');
    // Purple only ever means one thing in a tournament.
    expect(legend.rows.filter((row) => row.tone === 'purple')).toHaveLength(1);
  });

  it('spreadsheet-32 has the yellow row and no purple row: R6B and R6C are one group', () => {
    const example = WATERFALL_EXAMPLES.find((entry) => entry.id === 'spreadsheet-32');
    if (!example) throw new Error('no spreadsheet example');
    const legend = bracketLegend(
      generated(32, {
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'none',
        waterfallGraph: example.text,
      }),
    );
    const yellow = legend.rows.find((row) => row.tone === 'yellow');
    expect(yellow?.name).toBe('Through to another round');
    expect(legend.rows.some((row) => row.tone === 'purple')).toBe(false);
    expect(legend.rows.map((row) => row.name)).not.toContain('Losers bracket');
  });

  it('a waterfall round with three different destinations has the second and the third row', () => {
    const graph = `
ROUNDS:
R1 = 4x8
Upper = 8
Lower = 2x8
Ranking = 8 RANKING
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Upper, 5-8->Lower
R1.B: 1-4->Upper, 5-8->Lower
R1.C: 1-4->Lower, 5-8->Ranking
R1.D: 1-4->Lower, 5-8->Ranking
Upper: 1-4->Final, 5-8->eliminated
Lower.A: 1-2->Final, 3-8->eliminated
Lower.B: 1-2->Final, 3-8->eliminated
Ranking: 1-8->eliminated
`;
    const rows = bracketLegend(buildQualWaterfall(32, graph, { poolingPhase: 'none' })).rows;
    expect(rows.map((row) => row.tone)).toEqual(
      expect.arrayContaining(['green', 'yellow', 'purple', 'red', 'dashed']),
    );
    expect(rows.map((row) => row.name)).toContain('Through to a third round');
  });

  it('a waterfall where every room and the Qual source have one destination has no yellow or purple row', () => {
    const graph = `
ROUNDS:
R1 = 2x8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1
R1.A: 1-4->Final, 5-8->eliminated
R1.B: 1-4->Final, 5-8->eliminated
`;
    const legend = bracketLegend(buildQualWaterfall(32, graph));
    expect(legend.rows.some((row) => row.tone === 'yellow' || row.tone === 'purple')).toBe(false);
  });
});

describe('bracketLegend -- the fair cut', () => {
  const mixed = generated(43, { scheduleLogic: 'single-elimination', poolingPhase: 'none' });

  it('explains the fair cut for a tournament with cutVersion, and the earlier sentence without it', () => {
    expect(bracketLegend(mixed).luckyLosers).toBe(true);
    expect(bracketLegend(mixed).luckyText).toContain('fair share of the cut');
    expect(bracketLegend(withEarlierCutRule(mixed)).luckyText).toBe(
      "Spare spots are awarded to players by score relative to their room's average.",
    );
  });

  it('shows the lucky-loser row where a covered round has spots, even when its stored luckyCount is 0', () => {
    // 2v2v2v2 37: the first elimination round stores luckyCount 0, but its rooms of 4 and 3 share a spare cut.
    const state = generated(
      37,
      { gameFormat: 'team-2v2v2v2', scheduleLogic: 'single-elimination', poolingPhase: 'none' },
      true,
    );
    // Every stored lucky-loser count is 0, so only the fair cut's own spots can show the row.
    const noStored = { ...state, rounds: state.rounds.map((round) => ({ ...round, luckyCount: 0 })) };
    expect(noStored.rounds.every((round) => round.luckyCount === 0)).toBe(true);
    expect(bracketLegend(noStored).luckyLosers).toBe(true);
    expect(bracketLegend(withEarlierCutRule(noStored)).luckyLosers).toBe(false);
  });
});
