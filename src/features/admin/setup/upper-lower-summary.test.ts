import { describe, expect, it } from 'vitest';
import { generateTournament } from '../../../domain/tournament/generation';
import { rosterFor, testRuntime } from '../../../domain/tournament/__tests__/test-fixtures';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { NO_ROSTER_TEXT, upperLowerSummary } from './upper-lower-summary';

const form = (setup: Parameters<typeof createDefaultSetup>[0] = {}) =>
  createDefaultSetup({ scheduleLogic: 'upper-lower', poolingPhase: 'qual-table', ...setup });

const readyOf = (summary: ReturnType<typeof upperLowerSummary>) => {
  if (summary.kind !== 'ready')
    throw new Error(`expected ready, got ${summary.kind}: ${JSON.stringify(summary)}`);
  return summary;
};

describe('the Setup panel of an upper and lower bracket', () => {
  it('waits for a roster', () => {
    expect(upperLowerSummary(form(), null)).toEqual({ kind: 'waiting', message: NO_ROSTER_TEXT });
  });

  it('31 of 31 enter: upper 8, 8 · lower 8, 7, one line per round', () => {
    const summary = readyOf(upperLowerSummary(form(), 31));
    expect(summary.heading).toBe('31 of 31 enter: upper 8, 8 · lower 8, 7');
    expect(summary.rounds.map((round) => round.name)).toEqual([
      'Round 4 - Upper',
      'Round 4 - Lower',
      'Semi-Final A',
      'Round 5 - Lower',
      'Round 5 - Ranking',
      'Round 6 - Lower',
      'Round 6 - Ranking',
      'Semi-Final B',
      'Final',
    ]);
    expect(summary.rounds[0]).toEqual({
      name: 'Round 4 - Upper',
      rooms: '2 rooms: 8, 8',
      goes: '1–4 → Semi-Final A · 5–8 → Round 5 - Lower',
    });
    expect(summary.rounds[1].rooms).toBe('2 rooms: 8, 7');
    expect(summary.rounds[4]).toEqual({
      name: 'Round 5 - Ranking',
      rooms: '1 room of 7',
      goes: 'placement match: everyone is out after it',
    });
    expect(summary.rounds.at(-1)?.goes).toBe('the title is decided here');
  });

  it('37 registered: 32 of 37 enter, the 5 out named by the pooling phase', () => {
    expect(readyOf(upperLowerSummary(form(), 37)).heading).toBe(
      '32 of 37 enter (5 out in the qualification table): upper 8, 8 · lower 8, 8',
    );
    expect(
      readyOf(upperLowerSummary(form({ poolingPhase: 'swiss', gameFormat: 'individual-1v1' }), 11)).heading,
    ).toBe('8 of 11 enter (3 out in the Swiss): upper 2, 2 · lower 2, 2');
  });

  it('names the ranks of a lower round whose ranking room is left out as out', () => {
    const summary = readyOf(upperLowerSummary(form(), 24));
    expect(summary.rounds.find((round) => round.name === 'Round 4 - Lower')?.goes).toBe(
      '1–4 → Round 5 - Lower · 5–6 out',
    );
  });

  it('the refusals read as generation words them', () => {
    expect(upperLowerSummary(form({ poolingPhase: 'none' }), 31)).toEqual({
      kind: 'refused',
      message:
        'An upper and lower bracket splits the qualifiers by their pooling place: choose a Qualification Table, a Swiss or a Group Stage.',
    });
    expect(upperLowerSummary(form(), 11)).toEqual({
      kind: 'refused',
      message: 'This format needs at least 12 registered players. Registered: 11.',
    });
    expect(upperLowerSummary(form({ upperLowerAdvance: '20' }), 30)).toEqual({
      kind: 'refused',
      message: 'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
    });
    expect(
      upperLowerSummary(form({ poolingPhase: 'group-stage', gameFormat: 'team-4v4', groupSize: '4' }), 11),
    ).toEqual({
      kind: 'refused',
      message:
        "An upper and lower bracket takes 8 teams, and 3 groups can't each send the same number: choose Even split or Fair cut.",
    });
  });

  it('follows "Advance to bracket"', () => {
    expect(readyOf(upperLowerSummary(form({ upperLowerAdvance: '28' }), 31)).heading).toBe(
      '28 of 31 enter (3 out in the qualification table): upper 7, 7 · lower 7, 7',
    );
  });
});

describe('the Setup panel and generation agree on a group stage', () => {
  const groupForm = (setup: Parameters<typeof createDefaultSetup>[0]) =>
    form({ poolingPhase: 'group-stage', groupSize: '4', oddCountStrategy: 'bye', ...setup });
  const generated = (setup: ReturnType<typeof groupForm>, count: number) => {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: count, players: rosterFor(setup.gameFormat, count) }),
      setup,
      testRuntime(),
    );
    return result.status === 'generated' ? null : result.message;
  };
  const cases = (['team-4v4', 'individual-1v1'] as const).flatMap((gameFormat) =>
    (['per-group', 'even-split', 'fair-cut'] as const).flatMap((groupExit) =>
      Array.from({ length: 14 }, (_, index) => ({ gameFormat, groupExit, count: index + 4 })),
    ),
  );

  it.each(cases)(
    '$gameFormat, $groupExit, $count teams: ready exactly when generation generates, the same words when not',
    ({ gameFormat, groupExit, count }) => {
      const setup = groupForm({ gameFormat, groupExit });
      const summary = upperLowerSummary(setup, count);
      const refusal = generated(setup, count);
      expect(summary.kind === 'ready', String(refusal)).toBe(refusal === null);
      if (summary.kind === 'refused') expect(summary.message).toBe(refusal);
    },
  );

  it('8 of 8 teams enter with a fair cut, as 8 do from 9', () => {
    for (const count of [8, 9]) {
      const summary = upperLowerSummary(groupForm({ gameFormat: 'team-4v4', groupExit: 'fair-cut' }), count);
      expect(summary.kind).toBe('ready');
      if (summary.kind === 'ready') expect(summary.heading).toMatch(/^8 of /);
    }
  });
});
