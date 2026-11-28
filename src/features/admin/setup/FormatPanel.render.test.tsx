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
import { appValueOf } from './plan-decisions';
import { useAppPlan } from './useAppPlan';

// The real reader, counted: only a typed field may take a plan of its own.
vi.mock('./plan-decisions', async (importOriginal) => {
  const real = await importOriginal<typeof import('./plan-decisions')>();
  return { ...real, appValueOf: vi.fn(real.appValueOf) };
});

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

describe('the app’s number at each override field', () => {
  /** The panel with its plan, as SetupView holds it; `typed` is the plan's head count field. */
  function PlannedPanel({ typed }: { typed: string | null }) {
    const appPlan = useAppPlan(typed, '2');
    return (
      <FormatPanel
        appPlan={appPlan}
        error=''
        lbQualifiers='2'
        onGenerate={() => {}}
        setLbQualifiers={() => {}}
      />
    );
  }

  function draw(setup: PersistedSetup, confirmedCount: number | null, typed: string | null = null) {
    const players = Array.from({ length: confirmedCount ?? 0 }, (_, index) => `P${index + 1}`);
    const roster = confirmedCount === null ? {} : { confirmedCount, players };
    current = { state: createDefaultTournamentState(roster), setup };
    vi.mocked(appValueOf).mockClear();
    render(<PlannedPanel typed={typed} />);
  }

  const placeholder = (id: string) => (document.getElementById(id) as HTMLInputElement).placeholder;
  const wouldUse = () => [...(document.body.textContent ?? '').matchAll(/The app would use ([\d, ]+)\./g)];
  const wouldUseAt = (id: string) =>
    /The app would use [\d, ]+\./.exec(document.getElementById(id)?.parentElement?.textContent ?? '')?.[0];

  it('shows each empty field the app’s number, at 37 FFA', () => {
    draw(newTournamentSetup(), 37);
    expect(
      [
        'cfg-qual-rounds-override',
        'cfg-non-counting-rounds',
        'cfg-qual-adv',
        'cfg-semis-override',
        'cfg-final-override',
        'cfg-elimination-round-targets',
      ].map(placeholder),
    ).toEqual(['app: 4', 'app: 1', 'app: 28', 'app: 16', 'app: 8', 'app: 23, 19, 16']);
    expect(wouldUse()).toEqual([]);
    expect(appValueOf).not.toHaveBeenCalled();
  });

  it('shows 3 table rounds for a setup without the switch', () => {
    draw(form({ poolingPhase: 'qual-table', nonCountingRounds: '0' }), 37);
    expect(placeholder('cfg-qual-rounds-override')).toBe('app: 3');
    // Its stored 0 is nobody's typing; its stored "Advance to bracket" 24 is a number of its own.
    expect(wouldUseAt('cfg-non-counting-rounds')).toBeUndefined();
    expect(wouldUseAt('cfg-qual-adv')).toBe('The app would use 28.');
  });

  it('shows a Swiss 5 rounds', () => {
    draw({ ...newTournamentSetup(), ...ONE_V_ONE, poolingPhase: 'swiss' }, 53);
    expect(placeholder('cfg-swiss-rounds-override')).toBe('app: 5');
  });

  it.each([
    ['cfg-semis-override', { semisOverride: '6' }, '16'],
    ['cfg-final-override', { finalOverride: '6' }, '8'],
    ['cfg-qual-adv', { qualAdv: '30' }, '28'],
    ['cfg-qual-rounds-override', { qualRoundsOverride: '6' }, '4'],
    ['cfg-non-counting-rounds', { nonCountingRounds: '0' }, '1'],
    ['cfg-elimination-round-targets', { eliminationRoundTargets: '20,16' }, '23, 19, 16'],
  ])('says under a typed %s what the app would use', (id, typedField, value) => {
    draw({ ...newTournamentSetup(), ...typedField }, 37);
    expect(wouldUseAt(id)).toBe(`The app would use ${value}.`);
    expect(wouldUse()).toHaveLength(1);
    expect(appValueOf).toHaveBeenCalledTimes(1);
  });

  it('says it under a typed number that the plan refuses', () => {
    draw({ ...newTournamentSetup(), qualAdv: '5' }, 37);
    expect(wouldUseAt('cfg-qual-adv')).toBe('The app would use 28.');
  });

  it('follows the plan’s head count, the line under "Advance to bracket" with it', () => {
    draw(newTournamentSetup(), 37, '53');
    expect(placeholder('cfg-qual-adv')).toBe('app: 40');
    expect(document.body.textContent).toContain(
      'Empty: 40, 75-85% of the 48 expected to play (9 in 10 of 53 registered), in 5 rooms of 8.',
    );
  });

  it('shows the numbers for a typed count with no roster', () => {
    draw(newTournamentSetup(), null, '43');
    expect(placeholder('cfg-qual-adv')).toBe('app: 32');
  });

  it.each([
    ['no count', null],
    ['a refused plan', 11],
  ])('keeps each field’s own words with %s', (_name, count) => {
    draw(newTournamentSetup(), count);
    expect(placeholder('cfg-qual-rounds-override')).toBe('derived');
    expect(placeholder('cfg-semis-override')).toBe('derived');
    expect(placeholder('cfg-elimination-round-targets')).toBe('e.g. 24,24,12,6');
    expect(placeholder('cfg-non-counting-rounds')).toBe('');
    expect(placeholder('cfg-qual-adv')).toBe(count === null ? 'automatic' : 'automatic: 11');
  });
});
