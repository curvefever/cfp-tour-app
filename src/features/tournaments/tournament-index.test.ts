import { describe, expect, it } from 'vitest';
import { adminListEntries, copyableTournaments, parseTournamentIndex } from './tournament-index';
import type { TournamentSummary } from './tournament-summary';

const entry = (overrides: Record<string, unknown> = {}) => ({
  title: 'Cup',
  status: 'published',
  started: false,
  testRun: false,
  scheduledAt: 1_790_000_000_000,
  createdAt: 10,
  finishedAt: null,
  gameFormat: 'ffa-individual',
  poolingPhase: 'qual-table',
  scheduleLogic: 'double-elimination-shared-final',
  unitCount: 37,
  ...overrides,
});

const summary = (overrides: Partial<TournamentSummary>): TournamentSummary => ({
  ...(entry() as unknown as TournamentSummary),
  id: 'x',
  ...overrides,
});

describe('parseTournamentIndex', () => {
  it('reads every entry, taking the id from its key', () => {
    const parsed = parseTournamentIndex({ a: entry(), b: entry({ title: 'Other', unitCount: 12 }) });
    expect(parsed.map((item) => [item.id, item.title, item.unitCount])).toEqual([
      ['a', 'Cup', 37],
      ['b', 'Other', 12],
    ]);
    expect(parsed[0]).toMatchObject({ status: 'published', scheduledAt: 1_790_000_000_000, testRun: false });
  });

  it('drops entries without a valid status, and anything that is not an object', () => {
    const parsed = parseTournamentIndex({ a: entry({ status: 'archived' }), b: 'x', c: null, d: entry() });
    expect(parsed).toHaveLength(1);
    expect(parseTournamentIndex(null)).toEqual([]);
    expect(parseTournamentIndex([entry()])).toEqual([]);
  });

  it('fills missing fields with defaults', () => {
    const [parsed] = parseTournamentIndex({ a: { status: 'draft' } });
    expect(parsed).toMatchObject({
      title: '',
      started: false,
      scheduledAt: null,
      createdAt: 0,
      unitCount: 0,
      gameFormat: 'ffa-individual',
    });
  });
});

describe('adminListEntries', () => {
  it('lists drafts, published and ongoing tournaments, newest first, without finished ones', () => {
    const listed = adminListEntries([
      summary({ id: 'old', status: 'draft', createdAt: 1 }),
      summary({ id: 'done', status: 'finished', createdAt: 5 }),
      summary({ id: 'new', status: 'published', started: true, createdAt: 9 }),
    ]);
    expect(listed.map((item) => item.id)).toEqual(['new', 'old']);
  });
});

describe('copyableTournaments', () => {
  it('offers every tournament that is not a draft, newest first', () => {
    const listed = copyableTournaments([
      summary({ id: 'draft', status: 'draft', createdAt: 9 }),
      summary({ id: 'a', status: 'finished', createdAt: 2 }),
      summary({ id: 'b', status: 'published', createdAt: 7 }),
    ]);
    expect(listed.map((item) => item.id)).toEqual(['b', 'a']);
  });
});
