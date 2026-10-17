import { describe, expect, it } from 'vitest';
import {
  findUnstorableNames,
  rosterFitsFormat,
  rosterNames,
  teamNames,
  unstorableNamesMessage,
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
