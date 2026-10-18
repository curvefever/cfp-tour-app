import { describe, expect, it } from 'vitest';
import { fixedIdSource } from '../../domain/tournament/__tests__/test-fixtures';
import { memberPlaceholders, parseWalkUpTeam } from './walk-up-team';

const ids = fixedIdSource();

describe('parseWalkUpTeam', () => {
  it('reads a team name and its members', () => {
    expect(parseWalkUpTeam('Late Team, Alice, Bob', 2, ids)).toEqual({
      status: 'parsed',
      team: {
        teamId: 'team_0',
        teamName: 'Late Team',
        members: [{ name: 'Alice' }, { name: 'Bob' }],
      },
    });
  });

  it('pads the missing members as vacant slots', () => {
    const parsed = parseWalkUpTeam('Late Team, Alice', 3, ids);
    expect(parsed).toMatchObject({ status: 'parsed', team: { members: [{ name: 'Alice' }, null, null] } });
  });

  it('is empty for a blank line', () => {
    expect(parseWalkUpTeam('', 2, ids)).toEqual({ status: 'empty' });
    expect(parseWalkUpTeam('   ', 2, ids)).toEqual({ status: 'empty' });
  });

  it('names the team that has no players listed', () => {
    expect(parseWalkUpTeam('Lonely Team', 2, ids)).toEqual({
      status: 'no-members',
      message: '"Lonely Team" has no players listed — add at least one member.',
    });
  });
});

describe('memberPlaceholders', () => {
  it('lists one placeholder per member slot', () => {
    expect(memberPlaceholders(2)).toBe('Player1, Player2');
    expect(memberPlaceholders(3)).toBe('Player1, Player2, Player3');
  });
});
