import { describe, expect, it } from 'vitest';
import {
  formatKind,
  keyAfterTeamSizeChange,
  keyAfterTeamsPerRoomChange,
  keyForKind,
  nextTeamScoringRule,
  teamShape,
  teamSizeChoices,
  teamsPerRoomChoices,
} from './game-format-choice';
import { ONE_SCORE_PER_TEAM } from '../../../domain/tournament/formats';

describe('formatKind and keyForKind', () => {
  it('names the kind of every key', () => {
    expect(formatKind('ffa-individual')).toBe('ffa');
    expect(formatKind('individual-1v1')).toBe('1v1');
    expect(formatKind('team-2v2v2v2')).toBe('teams');
    expect(formatKind('team-5v5')).toBe('teams');
  });

  it('gives the key for a kind, with 2 players x 4 teams for Teams', () => {
    expect(keyForKind('ffa')).toBe('ffa-individual');
    expect(keyForKind('1v1')).toBe('individual-1v1');
    expect(keyForKind('teams')).toBe('team-2v2v2v2');
  });

  it('reads the shape of a team format, and the default shape for another key', () => {
    expect(teamShape('team-4v4')).toEqual({ teamSize: 4, teamsPerRoom: 2 });
    expect(teamShape('team-2v2v2')).toEqual({ teamSize: 2, teamsPerRoom: 3 });
    expect(teamShape('ffa-individual')).toEqual({ teamSize: 2, teamsPerRoom: 4 });
  });
});

describe('changing players per team', () => {
  it('keeps teams per room while it is still valid', () => {
    expect(keyAfterTeamSizeChange('team-2v2v2', 3)).toBe('team-3v3v3');
    expect(keyAfterTeamSizeChange('team-2v2', 5)).toBe('team-5v5');
    expect(keyAfterTeamSizeChange('team-3v3v3', 2)).toBe('team-2v2v2');
  });

  it('takes the largest valid count when it no longer fits', () => {
    expect(keyAfterTeamSizeChange('team-2v2v2v2', 3)).toBe('team-3v3v3');
    expect(keyAfterTeamSizeChange('team-2v2v2v2', 4)).toBe('team-4v4');
    expect(keyAfterTeamSizeChange('team-3v3v3', 5)).toBe('team-5v5');
    expect(keyAfterTeamSizeChange('team-4v4', 2)).toBe('team-2v2');
  });
});

describe('changing teams per room', () => {
  it('keeps the team size', () => {
    expect(keyAfterTeamsPerRoomChange('team-4v4', 2)).toBe('team-4v4');
    expect(keyAfterTeamsPerRoomChange('team-2v2', 5)).toBe('team-2v2v2v2v2');
    expect(keyAfterTeamsPerRoomChange('team-3v3', 3)).toBe('team-3v3v3');
  });
});

describe('the select options', () => {
  it('offers 2 to 5 players per team', () => {
    expect(teamSizeChoices().map((choice) => choice.value)).toEqual([2, 3, 4, 5]);
  });

  it('offers only the valid teams per room, each with the format it makes', () => {
    expect(teamsPerRoomChoices(2).map((choice) => choice.label)).toEqual([
      '2 (2v2)',
      '3 (2v2v2)',
      '4 (2v2v2v2)',
      '5 (2v2v2v2v2)',
    ]);
    expect(teamsPerRoomChoices(3).map((choice) => choice.label)).toEqual(['2 (3v3)', '3 (3v3v3)']);
    expect(teamsPerRoomChoices(4)).toEqual([{ value: 2, label: '2 (4v4)' }]);
    expect(teamsPerRoomChoices(5)).toEqual([{ value: 2, label: '2 (5v5)' }]);
  });
});

describe('nextTeamScoringRule', () => {
  it('keeps the rule between two team formats', () => {
    expect(nextTeamScoringRule({ gameFormat: 'team-2v2v2v2', teamScoringRule: ONE_SCORE_PER_TEAM }, 4)).toBe(
      ONE_SCORE_PER_TEAM,
    );
  });

  it('starts at "Sum of all members" when entering teams, and has none for an individual format', () => {
    expect(nextTeamScoringRule({ gameFormat: 'ffa-individual', teamScoringRule: '' }, 3)).toBe('sum-members');
    expect(
      nextTeamScoringRule({ gameFormat: 'ffa-individual', teamScoringRule: ONE_SCORE_PER_TEAM }, 3),
    ).toBe('sum-members');
    expect(
      nextTeamScoringRule({ gameFormat: 'team-3v3', teamScoringRule: ONE_SCORE_PER_TEAM }, undefined),
    ).toBe('');
  });

  it('falls back to "Sum of all members" when a team format had no rule set', () => {
    expect(nextTeamScoringRule({ gameFormat: 'team-3v3', teamScoringRule: '' }, 2)).toBe('sum-members');
  });
});
