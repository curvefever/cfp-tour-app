import { describe, expect, it } from 'vitest';
import {
  findUnit,
  findUnstorableNames,
  rosterFitsFormat,
  rosterNames,
  teamNames,
  typedRosterProblem,
  unitDisplay,
  unstorableNamesMessage,
  withUnit,
  withoutUnit,
} from '../roster';
import type { TournamentTeam } from '../types';
import { rosterFor } from './test-fixtures';

describe('findUnstorableNames', () => {
  it.each([
    ['a dot', 'A.B'],
    ['a hash', 'x#1'],
    ['a dollar sign', 'a$b'],
    ['a slash', 'a/b'],
    ['an opening bracket', 'm[1'],
    ['a closing bracket', 'm1]'],
    ['a control character', 'tab\tname'],
    ['a null character', 'nul\u0000name'],
    ['a delete character', 'del\u007fname'],
  ])('reports a name with %s', (_, name) => {
    expect(findUnstorableNames([name])).toEqual([name]);
  });

  it('lets clean names through: spaces, hyphens, apostrophes, accents, emoji, Ølaf', () => {
    expect(findUnstorableNames(['Team Rocket', 'Jean-Luc', "O'Brien", 'Zoë', '🔥 Fire', 'Ølaf'])).toEqual([]);
  });

  it('reports each offender once, trimmed, in input order', () => {
    expect(findUnstorableNames(['ok', ' b.b ', 'a#', 'b.b', 'c/d', 'a#'])).toEqual(['b.b', 'a#', 'c/d']);
  });
});

describe('unstorableNamesMessage', () => {
  it('names the single offender', () => {
    expect(unstorableNamesMessage(['A.B'])).toBe(
      '"A.B" contains a character that can\'t be used (. # $ / [ ]) — pick a different name.',
    );
  });

  it('lists several offenders one per line', () => {
    expect(unstorableNamesMessage(['x#1', 'a/b'])).toBe(
      "These name(s) contain a character that can't be used (. # $ / [ ]):\n\nx#1\na/b",
    );
  });
});

describe('teamNames and rosterNames', () => {
  const team: TournamentTeam = {
    teamId: 't1',
    teamName: 'Team One',
    members: [{ name: 'Alice' }, null, { name: 'Bob' }],
  };

  it('lists a team name and its filled members, skipping an empty slot', () => {
    expect(teamNames(team)).toEqual(['Team One', 'Alice', 'Bob']);
  });

  it('lists individuals as they are and teams by their names', () => {
    expect(rosterNames(['P1', 'P2'])).toEqual(['P1', 'P2']);
    expect(rosterNames([team])).toEqual(['Team One', 'Alice', 'Bob']);
  });
});

describe('rosterFitsFormat', () => {
  const loaded = (players: TournamentTeam[] | string[], reserves: TournamentTeam[] | string[] = []) => ({
    players,
    reserves,
  });

  it.each(['ffa-individual', 'individual-1v1'] as const)('fits plain names under %s', (format) => {
    expect(rosterFitsFormat(loaded(['P1', 'P2']), format)).toBe(true);
  });

  it('fits teams of 2 under team-2v2v2v2', () => {
    expect(rosterFitsFormat(loaded(rosterFor('team-2v2v2v2', 5) as TournamentTeam[]), 'team-2v2v2v2')).toBe(
      true,
    );
  });

  it('does not fit a team under ffa-individual (the reported case)', () => {
    expect(rosterFitsFormat(loaded(rosterFor('team-2v2v2v2', 1) as TournamentTeam[]), 'ffa-individual')).toBe(
      false,
    );
  });

  it('does not fit plain names under team-3v3v3', () => {
    expect(rosterFitsFormat(loaded(['P1', 'P2']), 'team-3v3v3')).toBe(false);
  });

  it('does not fit teams of 2 under team-3v3v3', () => {
    expect(rosterFitsFormat(loaded(rosterFor('team-2v2v2v2', 3) as TournamentTeam[]), 'team-3v3v3')).toBe(
      false,
    );
  });

  it('does not fit when only a reserve is of the wrong kind', () => {
    const teams = rosterFor('team-2v2v2v2', 3) as TournamentTeam[];
    expect(rosterFitsFormat(loaded(teams, teams.slice(0, 1)), 'team-2v2v2v2')).toBe(true);
    expect(rosterFitsFormat(loaded(['P1', 'P2'], teams.slice(0, 1)), 'ffa-individual')).toBe(false);
  });

  it.each(['ffa-individual', 'team-2v2v2v2', 'team-3v3'] as const)(
    'fits an empty roster under %s',
    (format) => {
      expect(rosterFitsFormat(loaded([]), format)).toBe(true);
    },
  );
});

describe('unitDisplay of a team that left the roster', () => {
  const state = {
    gameFormat: 'team-2v2' as const,
    players: [] as TournamentTeam[],
    reserves: [] as TournamentTeam[],
    withdrawnUnits: [
      {
        name: 'team_9',
        label: 'Team 9',
        members: ['a9', 'b9'],
        playedAnyMatch: true,
        reason: 'swapped' as const,
      },
    ],
  };

  it('reads its name and members as they were when it left', () => {
    expect(unitDisplay(state, 'team_9')).toEqual({ label: 'Team 9', members: ['a9', 'b9'] });
  });

  it('falls back to the key for a unit that never was on the roster', () => {
    expect(unitDisplay(state, 'team_x')).toEqual({ label: 'team_x', members: null });
  });
});

describe('findUnit, withoutUnit and withUnit: a roster of names or of teams', () => {
  const team = (id: string): TournamentTeam => ({ teamId: id, teamName: id, members: [{ name: `${id}a` }] });

  it('find a unit by its name or its team id', () => {
    expect(findUnit(['Ann', 'Bob'], 'Bob')).toBe('Bob');
    expect(findUnit(['Ann', 'Bob'], 'Cy')).toBeUndefined();
    expect(findUnit([team('t1'), team('t2')], 't2')).toEqual(team('t2'));
    expect(findUnit([team('t1')], 'Ann')).toBeUndefined();
  });

  it('take a unit out into a new list, whether or not it was there', () => {
    const names = ['Ann', 'Bob'];
    expect(withoutUnit(names, 'Ann')).toEqual(['Bob']);
    expect(withoutUnit(names, 'Cy')).toEqual(names);
    expect(withoutUnit(names, 'Cy')).not.toBe(names);
    const teams = [team('t1'), team('t2')];
    expect(withoutUnit(teams, 't1')).toEqual([team('t2')]);
    expect(withoutUnit(teams, 'zz')).not.toBe(teams);
  });

  it('put a unit in at the end, into a new list', () => {
    const names = ['Ann'];
    expect(withUnit(names, 'Bob')).toEqual(['Ann', 'Bob']);
    expect(names).toEqual(['Ann']);
    expect(withUnit([team('t1')], team('t2'))).toEqual([team('t1'), team('t2')]);
  });

  it('read an empty list as either shape', () => {
    expect(findUnit([], 'Ann')).toBeUndefined();
    const empty: string[] = [];
    expect(withoutUnit(empty, 'Ann')).toEqual([]);
    expect(withoutUnit(empty, 'Ann')).not.toBe(empty);
    expect(withUnit(empty, 'Ann')).toEqual(['Ann']);
    expect(withUnit([], team('t1'))).toEqual([team('t1')]);
  });
});

describe('typedRosterProblem: the first problem of a typed roster, as text', () => {
  const team = (name: string, members: Array<string | null>): TournamentTeam => ({
    teamId: name,
    teamName: name,
    members: members.map((member) => (member ? { name: member } : null)),
  });
  const TWICE = 'are used more than once across the roster and reserves';

  it('is null for a roster that can be loaded, in either shape', () => {
    expect(typedRosterProblem(['Ann', 'Bob'], [])).toBeNull();
    expect(
      typedRosterProblem([team('Red', ['Ann', null]), team('Blue', ['Bob', 'Cy'])], [{ name: 'Gus' }]),
    ).toBeNull();
    expect(typedRosterProblem([], [])).toBeNull();
  });

  it('says a name the database cannot store first, whatever else is wrong', () => {
    expect(typedRosterProblem(['A.nn', 'A.nn'], [])).toBe(unstorableNamesMessage(['A.nn']));
    expect(typedRosterProblem([team('Re.d', [null])], [{ name: 'G#us' }])).toBe(
      unstorableNamesMessage(['Re.d', 'G#us']),
    );
  });

  it('says a team with no player before a name used twice, and names each such team', () => {
    expect(typedRosterProblem([team('Red', [null]), team('Red', []), team('Blue', ['Ann'])], [])).toBe(
      'These team(s) have no players listed at all — add at least one "TeamName, Player1, ..." member, or remove the line:\n\nRed\nRed',
    );
  });

  it('says a name used twice last, in the words of its shape', () => {
    expect(typedRosterProblem(['Ann', 'Bob', 'Ann'], [])).toBe(
      `These name(s) ${TWICE} — every player needs a unique name:\n\nAnn`,
    );
    expect(typedRosterProblem([team('Red', ['Ann']), team('Red', ['Bob'])], [])).toBe(
      `These team name(s) ${TWICE} — every team needs a unique name:\n\nRed`,
    );
  });
});
