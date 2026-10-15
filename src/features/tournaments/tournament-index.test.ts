import { describe, expect, it } from 'vitest';
import {
  adminListEntries,
  copyableTournaments,
  parseTournamentIndex,
  parseWinners,
} from './tournament-index';
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

describe('winners in the list entry', () => {
  const parseOne = (overrides: Record<string, unknown>) => parseTournamentIndex({ a: entry(overrides) })[0];

  it('reads the winners of a finished tournament, a team with its members', () => {
    const parsed = parseOne({
      status: 'finished',
      winners: [
        { label: 'Team 1', members: ['a1', 'b1'] },
        { label: 'Solo', members: null },
      ],
    });
    expect(parsed?.winners).toEqual([
      { label: 'Team 1', members: ['a1', 'b1'] },
      { label: 'Solo', members: null },
    ]);
  });

  it('has none for an older tournament, or an empty list', () => {
    expect(parseOne({ status: 'finished' })).not.toHaveProperty('winners');
    expect(parseOne({ status: 'finished', winners: [] })).not.toHaveProperty('winners');
  });

  it('drops bad winners and keeps the valid ones', () => {
    expect(parseWinners('Team 1')).toBeUndefined();
    expect(parseWinners({ label: 'Team 1' })).toBeUndefined();
    expect(parseWinners([null, 'x', { label: 3 }, { label: '  ' }])).toBeUndefined();
    expect(
      parseWinners([
        { label: 'Team 1', members: 'a1' },
        { label: 'Team 2', members: ['a2', 7, 'b2'] },
      ]),
    ).toEqual([
      { label: 'Team 1', members: null },
      { label: 'Team 2', members: ['a2', 'b2'] },
    ]);
    // The list stays readable whatever the winners hold.
    expect(parseOne({ status: 'finished', winners: 5 })?.title).toBe('Cup');
  });
});
