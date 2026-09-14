import { describe, expect, it } from 'vitest';
import { PRODUCTION_TOUR_HOSTNAME, getTourEnvironment, getTournamentRootPath } from './firebase-paths';

describe('Firebase tournament paths', () => {
  it('uses the production namespace only for the production hostname', () => {
    expect(getTourEnvironment(PRODUCTION_TOUR_HOSTNAME)).toBe('prod');
    expect(getTournamentRootPath(PRODUCTION_TOUR_HOSTNAME)).toBe('environments/prod/tournaments');
  });

  it.each(['tournaments-test.curvefever.pro', 'localhost', '127.0.0.1', 'preview.example.com', undefined])(
    'fails safely to the test namespace for %s',
    (hostname) => {
      expect(getTourEnvironment(hostname)).toBe('test');
      expect(getTournamentRootPath(hostname)).toBe('environments/test/tournaments');
    },
  );

  it('normalizes hostname casing and whitespace', () => {
    expect(getTourEnvironment(`  ${PRODUCTION_TOUR_HOSTNAME.toUpperCase()}  `)).toBe('prod');
  });
});
