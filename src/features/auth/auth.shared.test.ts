import { describe, expect, it } from 'vitest';
import {
  Role,
  TOUR_ADMIN_ROLE_IDS,
  canAdminTour,
  extractAccountRoles,
  formatAccountRole,
  getAnonymousAuthSnapshot,
  getUserIdFromPayload,
  getUsernameFromPayload,
} from './auth.shared';

describe('Tour Hub admin roles', () => {
  it('allows the configured CFP roles', () => {
    expect(TOUR_ADMIN_ROLE_IDS).toEqual([
      Role.ADMIN,
      Role.MOD,
      Role.LEAD_MOD,
      Role.DEVELOPER,
      Role.TOUR_HOST,
      Role.LEAD_TOUR_HOST,
    ]);
    for (const role of TOUR_ADMIN_ROLE_IDS) expect(canAdminTour([role])).toBe(true);
  });

  it('rejects CFP roles outside the admin allowlist', () => {
    expect(canAdminTour([Role.TRANSLATOR])).toBe(false);
    expect(canAdminTour([Role.ARTIST, Role.CONTENT_CREATOR])).toBe(false);
    expect(canAdminTour([])).toBe(false);
  });
});

describe('extractAccountRoles', () => {
  it('normalizes a numeric array', () => {
    expect(extractAccountRoles({ accountRoles: [1, 3] })).toEqual([1, 3]);
  });

  it('parses whitespace-padded numeric strings', () => {
    expect(extractAccountRoles({ roles: [' 5 '] })).toEqual([5]);
  });

  it('falls back through role -> id -> roleID -> type for an object-shaped entry', () => {
    expect(extractAccountRoles({ roleIDs: [{ role: 8 }] })).toEqual([8]);
    expect(extractAccountRoles({ roleIDs: [{ id: 9 }] })).toEqual([9]);
    expect(extractAccountRoles({ roleIDs: [{ roleID: 20 }] })).toEqual([20]);
    expect(extractAccountRoles({ roleIDs: [{ type: 21 }] })).toEqual([21]);
  });

  it('prefers role over id/roleID/type when several are set on the same entry', () => {
    expect(extractAccountRoles({ roleIDs: [{ role: 1, id: 2, roleID: 3, type: 4 }] })).toEqual([1]);
  });

  it('truncates a decimal-looking string ("8.5") to 8, but rejects a real decimal number', () => {
    // A real asymmetry between the string and number code paths: the string branch
    // uses Number.parseInt (truncates), the number branch uses Number.isInteger (rejects).
    expect(extractAccountRoles({ roles: ['8.5'] })).toEqual([8]);
    expect(extractAccountRoles({ roles: [8.5] })).toEqual([]);
  });

  it('filters out null/undefined/boolean entries', () => {
    expect(extractAccountRoles({ roles: [null, undefined, true, 5] })).toEqual([5]);
  });

  it('ignores a non-array value for one of the three source keys', () => {
    expect(extractAccountRoles({ accountRoles: 'not-an-array', roles: [1] })).toEqual([1]);
  });

  it('dedupes roles that appear across accountRoles/roles/roleIDs', () => {
    expect(extractAccountRoles({ accountRoles: [1], roles: [1, 2], roleIDs: [2, 3] })).toEqual([1, 2, 3]);
  });

  it('returns an empty array for an empty payload', () => {
    expect(extractAccountRoles({})).toEqual([]);
  });
});

describe('getUsernameFromPayload', () => {
  it('trims and returns a present username', () => {
    expect(getUsernameFromPayload(' bob ', 'fallback')).toBe('bob');
  });

  it('falls back (also trimmed) when the username is undefined, empty, or whitespace-only', () => {
    expect(getUsernameFromPayload(undefined, ' fallback ')).toBe('fallback');
    expect(getUsernameFromPayload('', ' fallback ')).toBe('fallback');
    expect(getUsernameFromPayload('   ', ' fallback ')).toBe('fallback');
  });

  it('returns an empty string when both are empty', () => {
    expect(getUsernameFromPayload(undefined)).toBe('');
  });
});

describe('getUserIdFromPayload', () => {
  it('prefers userId, then userID, then accountId, then accountID, then id', () => {
    expect(getUserIdFromPayload({ userId: 'a', userID: 'b', accountId: 'c', id: 'd' })).toBe('a');
    expect(getUserIdFromPayload({ userID: 'b', accountId: 'c', id: 'd' })).toBe('b');
    expect(getUserIdFromPayload({ accountId: 'c', id: 'd' })).toBe('c');
    expect(getUserIdFromPayload({ accountID: 'e', id: 'd' })).toBe('e');
    expect(getUserIdFromPayload({ id: 'd' })).toBe('d');
  });

  it('normalizes a finite numeric id to a string', () => {
    expect(getUserIdFromPayload({ id: 42 })).toBe('42');
  });

  it('rejects NaN/Infinity and falls through to the next candidate', () => {
    expect(getUserIdFromPayload({ userId: NaN, id: 5 })).toBe('5');
    expect(getUserIdFromPayload({ userId: Infinity, id: 5 })).toBe('5');
  });

  it('trims a string id', () => {
    expect(getUserIdFromPayload({ userId: '  x  ' })).toBe('x');
  });

  it('returns the trimmed fallback when every candidate is missing', () => {
    expect(getUserIdFromPayload({}, ' fallback-id ')).toBe('fallback-id');
  });
});

describe('getAnonymousAuthSnapshot', () => {
  it('returns the expected anonymous shape', () => {
    expect(getAnonymousAuthSnapshot()).toEqual({ roles: [], status: 'anonymous', userId: '', username: '' });
  });

  it('returns a fresh object on every call', () => {
    expect(getAnonymousAuthSnapshot()).not.toBe(getAnonymousAuthSnapshot());
  });
});

describe('formatAccountRole', () => {
  it('formats known roles in Title Case', () => {
    expect(formatAccountRole(Role.LEAD_TOUR_HOST)).toBe('Lead Tour Host');
    expect(formatAccountRole(Role.CONTENT_CREATOR)).toBe('Content Creator');
  });

  it('handles role 0 (ADMIN) correctly despite 0 being falsy', () => {
    expect(formatAccountRole(Role.ADMIN)).toBe('Admin');
  });

  it('falls back to "Role {id}" for a reserved/unknown role id', () => {
    expect(formatAccountRole(2)).toBe('Role 2');
    expect(formatAccountRole(999)).toBe('Role 999');
  });
});
