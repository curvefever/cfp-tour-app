// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeRosterUnit } from '../../domain/tournament/mutations';
import { pressNextRound, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { generated, testRuntime } from '../../domain/tournament/__tests__/test-fixtures';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { ManageRoster } from './RankingsRoster';

/** What the roster panel handed to `updateState`, in order (a state, or the state a function made from the current one). */
const saved: TournamentState[] = [];
let current: TournamentState;

vi.mock('../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    runtime: testRuntime(),
    updateState: (update: TournamentState | ((state: TournamentState) => TournamentState)) =>
      saved.push(typeof update === 'function' ? update(current) : update),
  }),
}));

let alerts: string[];
let prompts: Array<string | null>;
let confirms: boolean[];

beforeEach(() => {
  saved.length = 0;
  alerts = [];
  prompts = [];
  confirms = [];
  vi.spyOn(window, 'alert').mockImplementation((message) => void alerts.push(String(message)));
  vi.spyOn(window, 'prompt').mockImplementation(() => prompts.shift() ?? null);
  vi.spyOn(window, 'confirm').mockImplementation(() => confirms.shift() ?? false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const started = (state: TournamentState): TournamentState => ({ ...state, started: true });

/** Plays on until the round in play is an elimination round: no pooling round, so no late joiners, and nobody out yet. */
function inEliminationRound(state: TournamentState, teamSize: number): TournamentState {
  let next = started(state);
  while (next.rounds[next.curRound].isNoElim) next = pressNextRound(scoreCurrentRound(next, teamSize));
  return next;
}

function show(state: TournamentState) {
  current = state;
  render(<ManageRoster state={state} />);
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

const NOT_IN_PLAY = (unit: string) =>
  `Can't swap "${unit}" — it isn't in the current round or waiting for a later one.`;

describe('Manage players: what a refused rename says', () => {
  const players = () => started(generated(20, { scheduleLogic: 'single-elimination' }));

  it('renames to a free name', () => {
    show(players());
    prompts = ['Zed'];
    click('Rename P1');
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0].players).toContain('Zed');
    expect(saved[0].players).not.toContain('P1');
  });

  it('says nothing and changes nothing for a cancelled, empty or unchanged name', () => {
    show(players());
    for (const typed of [null, '   ', 'P1']) {
      prompts = [typed];
      click('Rename P1');
    }
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(0);
  });

  it('refuses a name that cannot be stored', () => {
    show(players());
    prompts = ['Bad.Name'];
    click('Rename P1');
    expect(alerts).toEqual([
      `"Bad.Name" contains a character that can't be used (. # $ / [ ]) — pick a different name.`,
    ]);
    expect(saved).toHaveLength(0);
  });

  it('refuses a name another player has', () => {
    show(players());
    prompts = ['  P2 '];
    click('Rename P1');
    expect(alerts).toEqual(['"P2" is already registered — pick a different name.']);
    expect(saved).toHaveLength(0);
  });

  it('refuses the name of a player who left', () => {
    show(removeRosterUnit(players(), 'P3'));
    prompts = ['P3'];
    click('Rename P1');
    expect(alerts).toEqual([
      '"P3" left this tournament earlier — a new player needs a different name (for example "P3 2").',
    ]);
    expect(saved).toHaveLength(0);
  });
});

describe('Manage players: what a refused swap says', () => {
  const players = () => started(generated(20, { scheduleLogic: 'single-elimination' }));

  it('swaps for a free name', () => {
    show(players());
    prompts = ['Zed'];
    click('Swap P1');
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0].players).toContain('Zed');
    expect(saved[0].withdrawnUnits.map((unit) => unit.name)).toEqual(['P1']);
  });

  it('says nothing for a cancelled or empty name', () => {
    show(players());
    for (const typed of [null, '  ']) {
      prompts = [typed];
      click('Swap P1');
    }
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(0);
  });

  it('refuses a name that cannot be stored', () => {
    show(players());
    prompts = ['a/b'];
    click('Swap P1');
    expect(alerts).toEqual([
      `"a/b" contains a character that can't be used (. # $ / [ ]) — pick a different name.`,
    ]);
  });

  it('refuses a name on the roster, but takes one from the reserves', () => {
    show(players());
    prompts = ['P2'];
    click('Swap P1');
    expect(alerts).toEqual(['"P2" is already registered — pick a different name.']);
    expect(saved).toHaveLength(0);
    cleanup();
    show({ ...players(), reserves: ['Res1'] });
    prompts = ['Res1'];
    click('Swap P1');
    expect(saved).toHaveLength(1);
    expect(saved[0].reserves).toEqual([]);
  });

  it('refuses the name of a player who left', () => {
    show(removeRosterUnit(players(), 'P3'));
    prompts = ['P3'];
    click('Swap P1');
    expect(alerts).toEqual([
      '"P3" left this tournament earlier — a new player needs a different name (for example "P3 2").',
    ]);
  });

  it('says the unit is not in play when the engine refuses the swap', () => {
    // An elimination round in play: a unit on the roster that has no seat is not in play.
    const state = inEliminationRound(
      generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
      0,
    );
    show({ ...state, players: [...(state.players as string[]), 'Ghost'] });
    prompts = ['Zed'];
    click('Swap Ghost');
    expect(alerts).toEqual([NOT_IN_PLAY('Ghost')]);
    expect(saved).toHaveLength(0);
  });
});

describe('Manage teams: what a refused change says', () => {
  const teamState = (extra: Partial<TournamentState> = {}) =>
    started({
      ...generated(8, { gameFormat: 'team-2v2', scheduleLogic: 'single-elimination' }),
      ...extra,
    });
  const reserveTeam = (id: string, name: string): TournamentTeam => ({
    teamId: id,
    teamName: name,
    members: [{ name: `${id}a` }, { name: `${id}b` }],
  });

  it('renames a team to a free name', () => {
    show(teamState());
    prompts = ['Reds'];
    click('Rename team Team 1');
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(1);
    expect((saved[0].players as TournamentTeam[])[0].teamName).toBe('Reds');
  });

  it('refuses a team name that cannot be stored, or is taken, and stays silent for a cancelled name', () => {
    show(teamState());
    prompts = ['Bad#Name'];
    click('Rename team Team 1');
    prompts = ['Team 2'];
    click('Rename team Team 1');
    prompts = [null];
    click('Rename team Team 1');
    expect(alerts).toEqual([
      `"Bad#Name" contains a character that can't be used (. # $ / [ ]) — pick a different name.`,
      'A team called "Team 2" is already registered — pick a different name.',
    ]);
    expect(saved).toHaveLength(0);
  });

  it('swaps a team for a reserve team', () => {
    show(teamState({ reserves: [reserveTeam('rt1', 'Reserve 1')] }));
    prompts = ['1'];
    click('Swap team Team 1');
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(1);
    expect((saved[0].players as TournamentTeam[]).map((team) => team.teamId)).toContain('rt1');
  });

  it('says a menu choice is not one of the listed numbers', () => {
    show(teamState({ reserves: [reserveTeam('rt1', 'Reserve 1')] }));
    prompts = ['7'];
    click('Swap team Team 1');
    expect(alerts).toEqual([`"7" isn't one of the listed numbers.`]);
    expect(saved).toHaveLength(0);
  });

  it('refuses a walk-up team with no players, one that cannot be stored, and one with a taken name', () => {
    show(teamState());
    prompts = ['Newcomers'];
    click('Swap team Team 1');
    prompts = ['Newcomers, A.b, C'];
    click('Swap team Team 1');
    prompts = ['Team 2, Anna, Bo'];
    click('Swap team Team 1');
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toMatch(/no players/i);
    expect(alerts[1]).toBe(
      `"A.b" contains a character that can't be used (. # $ / [ ]) — pick a different name.`,
    );
    expect(alerts[2]).toBe('A team called "Team 2" is already registered — pick a different name.');
    expect(saved).toHaveLength(0);
  });

  it('says the team is not in play when the engine refuses the swap', () => {
    const state = inEliminationRound(
      generated(8, { gameFormat: 'team-2v2', scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
      2,
    );
    const ghost = reserveTeam('ghost', 'Ghost team');
    show({ ...state, players: [...(state.players as TournamentTeam[]), ghost] });
    prompts = ['Fresh, Anna, Bo'];
    click('Swap team Ghost team');
    expect(alerts).toEqual([NOT_IN_PLAY('Ghost team')]);
    expect(saved).toHaveLength(0);
  });

  it('refuses to remove a team that would leave a room short under the strict odd-count strategy', () => {
    const state = teamState();
    show({ ...state, gamemodeConfig: { ...state.gamemodeConfig, oddCountStrategy: 'none' } });
    confirms = [true];
    click('Remove team Team 1');
    expect(alerts).toEqual([
      `Can't remove "Team 1" — the strict odd-count strategy requires rooms of 2 teams.`,
    ]);
    expect(saved).toHaveLength(0);
  });

  it('asks before it removes a team, and removes it once confirmed', () => {
    show(teamState());
    confirms = [false];
    click('Remove team Team 1');
    expect(saved).toHaveLength(0);
    confirms = [true];
    click('Remove team Team 1');
    expect(saved).toHaveLength(1);
    expect((saved[0].players as TournamentTeam[]).map((team) => team.teamId)).not.toContain('t1');
  });

  it('renames a member, and refuses a member name that cannot be stored', () => {
    show(teamState());
    prompts = ['Bad$Name'];
    click('Rename a0');
    expect(alerts).toEqual([
      `"Bad$Name" contains a character that can't be used (. # $ / [ ]) — pick a different name.`,
    ]);
    expect(saved).toHaveLength(0);
    prompts = ['Zara'];
    click('Rename a0');
    expect(saved).toHaveLength(1);
    expect((saved[0].players as TournamentTeam[])[0].members[0]?.name).toBe('Zara');
  });
});
