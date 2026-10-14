import { describe, expect, it } from 'vitest';
import { buildState } from '../../domain/tournament/__tests__/play-through';
import { QUAL_GRAPH, buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { WATERFALL_EXAMPLES } from '../../domain/tournament/waterfall-examples';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
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
    'a Qual source with two destinations (%i players) has a yellow row naming the second one and no purple row',
    (count) => {
      const legend = bracketLegend(buildQualWaterfall(count, QUAL_GRAPH));
      expect(legend.rows.filter((row) => row.tone === 'yellow')).toEqual([
        expect.objectContaining({ name: 'Through to R1C' }),
      ]);
      expect(legend.rows.some((row) => row.tone === 'purple')).toBe(false);
    },
  );

  it('a waterfall with three destinations has a yellow and a purple row naming them, and no Losers bracket row', () => {
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
    expect(rows).toContainEqual(['yellow', 'Through to R1C']);
    expect(rows).toContainEqual(['purple', 'Through to R1D']);
    expect(legend.rows.map((row) => row.name)).not.toContain('Losers bracket');
    // Purple only ever means one thing in a tournament.
    expect(legend.rows.filter((row) => row.tone === 'purple')).toHaveLength(1);
  });

  it('a waterfall room that sends places to three rounds names the second and third of them', () => {
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
    const purple = legend.rows.find((row) => row.tone === 'purple');
    // Rooms order their destinations differently, so each colour names every round that is second (or third) somewhere.
    expect(yellow?.name).toMatch(/^Through to /);
    expect(yellow?.name).toContain('R6B');
    expect(purple?.name).toMatch(/^Through to /);
    expect(purple?.name).toContain('R6C');
    expect(legend.rows.map((row) => row.name)).not.toContain('Losers bracket');
  });
});
