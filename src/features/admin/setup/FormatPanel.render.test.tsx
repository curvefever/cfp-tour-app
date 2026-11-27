// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSetup,
  createDefaultTournamentState,
  newTournamentSetup,
} from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { FormatPanel } from './FormatPanel';

/** What a change of the game format, the odd-count strategy or the scoring system writes: the whole form. */

let current: { state: ReturnType<typeof createDefaultTournamentState>; setup: PersistedSetup };
/** What the panel handed to `updateSetup`: the form after each change. */
const setups: PersistedSetup[] = [];

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    ...current,
    updateState: () => {},
    updateSetup: (change: (current: PersistedSetup) => PersistedSetup) => setups.push(change(current.setup)),
    setup: current.setup,
  }),
}));

beforeEach(() => {
  setups.length = 0;
});

afterEach(cleanup);

/** Renders the panel on `start`, sets one select to `value` and returns the form that choice wrote. */
function choose(start: PersistedSetup, id: string, value: string): PersistedSetup {
  current = { state: createDefaultTournamentState(), setup: start };
  render(<FormatPanel error='' lbQualifiers='2' onGenerate={() => {}} setLbQualifiers={() => {}} />);
  const select = document.getElementById(id) as HTMLSelectElement;
  expect([...select.options].map((option) => option.value)).toContain(value);
  fireEvent.change(select, { target: { value } });
  expect(setups).toHaveLength(1);
  return setups[0];
}

const form = (overrides: Partial<PersistedSetup> = {}) => createDefaultSetup(overrides);

const ONE_V_ONE = { gameFormat: 'individual-1v1', oddCountStrategy: 'bye' } as const;
/** A head-to-head team format: the only kind that offers Flex. */
const TWO_TEAMS = {
  gameFormat: 'team-2v2',
  oddCountStrategy: 'bye',
  teamScoringRule: 'sum-members',
} as const;

describe('a change of the game format', () => {
  it('FFA to 1v1 takes the format and its default odd-count strategy', () => {
    const start = form();
    expect(choose(start, 'cfg-game-format', '1v1')).toEqual({
      ...start,
      gameFormat: 'individual-1v1',
      oddCountStrategy: 'bye',
    });
  });

  it('1v1 to FFA clears the odd-count strategy', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'qual-table', scoring: 'positional-points' });
    expect(choose(start, 'cfg-game-format', 'ffa')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      oddCountStrategy: '',
    });
  });

  it.each(['swiss', 'group-stage'] as const)(
    '1v1 with %s to FFA takes a qualification table with its usual values',
    (poolingPhase) => {
      const start = form({ ...ONE_V_ONE, poolingPhase, scoring: 'match-results' });
      expect(choose(start, 'cfg-game-format', 'ffa')).toEqual({
        ...start,
        gameFormat: 'ffa-individual',
        oddCountStrategy: '',
        poolingPhase: 'qual-table',
        qualRoundsOverride: '4',
        nonCountingRounds: '1',
        scoring: 'fairpoints',
      });
    },
  );

  it('1v1 with a Swiss to FFA keeps a custom points table', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'swiss', scoring: 'positional-points' });
    expect(choose(start, 'cfg-game-format', 'ffa')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      oddCountStrategy: '',
      poolingPhase: 'qual-table',
      qualRoundsOverride: '4',
      nonCountingRounds: '1',
    });
  });

  it('1v1 with the race double elimination to FFA falls back to single elimination', () => {
    const start = form({ ...ONE_V_ONE, scheduleLogic: 'double-elimination' });
    expect(choose(start, 'cfg-game-format', 'ffa')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      oddCountStrategy: '',
      scheduleLogic: 'single-elimination',
    });
  });

  it.each(['double-elimination-shared-final', 'kings-valley'] as const)(
    'FFA with %s to 1v1 falls back to single elimination',
    (scheduleLogic) => {
      const start = form({ scheduleLogic });
      expect(choose(start, 'cfg-game-format', '1v1')).toEqual({
        ...start,
        gameFormat: 'individual-1v1',
        oddCountStrategy: 'bye',
        scheduleLogic: 'single-elimination',
      });
    },
  );

  it('FFA to a team format sets the team scoring to the sum of all members', () => {
    const start = form({ scheduleLogic: 'kings-valley' });
    expect(choose(start, 'cfg-game-format', 'teams')).toEqual({
      ...start,
      gameFormat: 'team-2v2v2v2',
      teamScoringRule: 'sum-members',
    });
  });

  it('one team format to another keeps the team scoring', () => {
    const start = form({ gameFormat: 'team-2v2v2v2', teamScoringRule: 'survival-teams' });
    expect(choose(start, 'cfg-teams-per-room', '2')).toEqual({
      ...start,
      gameFormat: 'team-2v2',
      oddCountStrategy: 'bye',
    });
  });

  it('a team format to FFA clears the team scoring', () => {
    const start = form({ gameFormat: 'team-2v2v2v2', teamScoringRule: 'survival-teams' });
    expect(choose(start, 'cfg-game-format', 'ffa')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      teamScoringRule: '',
    });
  });

  const MATCH_RESULTS = { ...TWO_TEAMS, poolingPhase: 'qual-table', scoring: 'match-results' } as const;

  it('with Match results, fills an empty tie margin with the new format’s default', () => {
    const start = form(MATCH_RESULTS);
    expect(choose(start, 'cfg-team-size', '4')).toEqual({
      ...start,
      gameFormat: 'team-4v4',
      tieMargin: '100',
    });
  });

  it('with Match results, keeps a typed tie margin', () => {
    const start = form({ ...MATCH_RESULTS, tieMargin: '55' });
    expect(choose(start, 'cfg-team-size', '4')).toEqual({ ...start, gameFormat: 'team-4v4' });
  });
});

describe('the FORMAT panel of a new tournament', () => {
  const draw = (setup: PersistedSetup, confirmedCount: number | null) => {
    current = { state: createDefaultTournamentState({ confirmedCount }), setup };
    render(<FormatPanel error='' lbQualifiers='2' onGenerate={() => {}} setLbQualifiers={() => {}} />);
    const field = document.getElementById('cfg-qual-adv') as HTMLInputElement;
    return { field, text: document.body.textContent };
  };

  it('shows a qualification table and, at 37 registered, the worked-out "Advance to bracket"', () => {
    const { field, text } = draw(newTournamentSetup(), 37);
    const pooling = document.getElementById('cfg-pooling-phase') as HTMLSelectElement;
    expect(pooling.value).toBe('qual-table');
    expect(pooling.selectedOptions[0].textContent).toBe('Qualification table');
    expect(field.value).toBe('');
    expect(field.placeholder).toBe('automatic: 28');
    expect(text).toContain(
      'Empty: 28, 75-85% of the 33 expected to play (9 in 10 of 37 registered), in 4 rooms of 7.',
    );
  });

  it('says the nearest the bracket can seat when the number is outside 75-85%: 12 at 14', () => {
    expect(draw(newTournamentSetup(), 14).text).toContain(
      'Empty: 12, the nearest the bracket can seat to 80% of the 13 expected to play (9 in 10 of 14 registered).',
    );
  });

  it('waits for a roster', () => {
    const { field, text } = draw(newTournamentSetup(), null);
    expect(field.placeholder).toBe('automatic');
    expect(text).toContain('Worked out from the head count once a roster is loaded.');
  });

  it('says nothing under a typed number', () => {
    const { text } = draw({ ...newTournamentSetup(), qualAdv: '20' }, 37);
    expect(text).not.toContain('Empty:');
  });
});

describe('a change of the pooling phase', () => {
  it('choosing Swiss puts in 5 rounds, all counted', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'qual-table', nonCountingRounds: '1' });
    expect(choose(start, 'cfg-pooling-phase', 'swiss')).toEqual({
      ...start,
      poolingPhase: 'swiss',
      swissRoundsOverride: '5',
      nonCountingRounds: '0',
    });
  });
});

describe('a change of the odd-count strategy', () => {
  it('to Flex takes the race double elimination back to single elimination', () => {
    const start = form({ ...TWO_TEAMS, scheduleLogic: 'double-elimination' });
    expect(choose(start, 'cfg-odd-count-strategy', 'flex')).toEqual({
      ...start,
      oddCountStrategy: 'flex',
      scheduleLogic: 'single-elimination',
    });
  });

  it('to Bye keeps the race double elimination', () => {
    const start = form({ ...ONE_V_ONE, oddCountStrategy: 'none', scheduleLogic: 'double-elimination' });
    expect(choose(start, 'cfg-odd-count-strategy', 'bye')).toEqual({ ...start, oddCountStrategy: 'bye' });
  });

  it('to Flex keeps the shared-Final double elimination', () => {
    const start = form({ ...TWO_TEAMS, scheduleLogic: 'double-elimination-shared-final' });
    expect(choose(start, 'cfg-odd-count-strategy', 'flex')).toEqual({ ...start, oddCountStrategy: 'flex' });
  });

  it('to Flex ends Match results after a qualification table', () => {
    const start = form({ ...TWO_TEAMS, poolingPhase: 'qual-table', scoring: 'match-results' });
    expect(choose(start, 'cfg-odd-count-strategy', 'flex')).toEqual({
      ...start,
      oddCountStrategy: 'flex',
      scoring: 'fairpoints',
    });
  });
});

describe('a change of the scoring system', () => {
  const FOURS = { ...TWO_TEAMS, gameFormat: 'team-4v4', poolingPhase: 'qual-table' } as const;

  it('to Match results fills an empty tie margin with the format’s default', () => {
    const start = form(FOURS);
    expect(choose(start, 'cfg-scoring', 'match-results')).toEqual({
      ...start,
      scoring: 'match-results',
      tieMargin: '100',
    });
  });

  it('to Match results keeps a typed tie margin', () => {
    const start = form({ ...FOURS, tieMargin: '55' });
    expect(choose(start, 'cfg-scoring', 'match-results')).toEqual({ ...start, scoring: 'match-results' });
  });

  it('to another system leaves the tie margin alone', () => {
    const start = form(FOURS);
    expect(choose(start, 'cfg-scoring', 'positional-points')).toEqual({
      ...start,
      scoring: 'positional-points',
    });
  });
});
