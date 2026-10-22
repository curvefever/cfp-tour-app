import { describe, expect, it } from 'vitest';
import { formatScheduledAt, scheduledDay, scheduledParts, tournamentFormatLine } from './tournament-info';

describe('tournamentFormatLine', () => {
  it('joins the game format, the pooling phase and the bracket', () => {
    expect(
      tournamentFormatLine({
        gameFormat: 'ffa-individual',
        poolingPhase: 'qual-table',
        scheduleLogic: 'double-elimination-shared-final',
      }),
    ).toBe('FFA · Qualification table · Double elimination');
    expect(
      tournamentFormatLine({
        gameFormat: 'individual-1v1',
        poolingPhase: 'swiss',
        scheduleLogic: 'single-elimination',
      }),
    ).toBe('1v1 · Swiss · Single elimination');
  });

  it('leaves out a missing pooling phase', () => {
    expect(
      tournamentFormatLine({
        gameFormat: 'team-3v3v3',
        poolingPhase: 'none',
        scheduleLogic: 'kings-valley',
      }),
    ).toBe('3v3v3 · Kings Valley');
  });

  it('names every format, pooling phase and bracket', () => {
    const formats = ['ffa-individual', 'team-2v2v2v2', 'team-3v3v3', 'team-3v3', 'individual-1v1'] as const;
    expect(
      formats.map((gameFormat) =>
        tournamentFormatLine({ gameFormat, poolingPhase: 'none', scheduleLogic: 'waterfall-bracket' }),
      ),
    ).toEqual([
      'FFA · Waterfall bracket',
      '2v2v2v2 · Waterfall bracket',
      '3v3v3 · Waterfall bracket',
      '3v3 · Waterfall bracket',
      '1v1 · Waterfall bracket',
    ]);
    expect(
      tournamentFormatLine({
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        scheduleLogic: 'double-elimination',
      }),
    ).toBe('1v1 · Group stage · Double elimination');
  });
});

describe('formatScheduledAt', () => {
  const SCHEDULED = Date.UTC(2026, 9, 18, 18, 0); // Sunday 18 Oct 2026, 18:00 UTC
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const inZone = (zone: string) => ({ timeZone: zone });

  it('shows the date and time in the time zone of the viewer', () => {
    expect(formatScheduledAt(SCHEDULED, SCHEDULED - 3 * HOUR, inZone('UTC'))).toMatch(
      /^Sun 18 Oct, 18:00 UTC · /,
    );
    expect(formatScheduledAt(SCHEDULED, SCHEDULED - 3 * HOUR, inZone('Europe/Paris'))).toMatch(
      /^Sun 18 Oct, 20:00 CEST · /,
    );
    expect(formatScheduledAt(SCHEDULED, SCHEDULED - 3 * HOUR, inZone('Pacific/Auckland'))).toMatch(
      /^Mon 19 Oct, 07:00 GMT\+13 · /,
    );
  });

  it('says how far away it is, in days, hours or minutes', () => {
    const at = (before: number) =>
      formatScheduledAt(SCHEDULED, SCHEDULED - before, inZone('UTC')).split(' · ')[1];
    expect(at(2 * 24 * HOUR + 2 * HOUR)).toBe('in 2 days');
    expect(at(30 * HOUR)).toBe('in 30 h');
    expect(at(2 * HOUR)).toBe('in 2 h');
    expect(at(45 * MINUTE)).toBe('in 45 min');
  });

  it('says how long ago it started', () => {
    const after = (late: number) =>
      formatScheduledAt(SCHEDULED, SCHEDULED + late, inZone('UTC')).split(' · ')[1];
    expect(after(3 * HOUR)).toBe('started 3 h ago');
    expect(after(10 * MINUTE)).toBe('started 10 min ago');
    expect(after(3 * 24 * HOUR)).toBe('started 3 days ago');
  });

  it('can leave out the relative part', () => {
    expect(formatScheduledAt(SCHEDULED, SCHEDULED + 3 * HOUR, { timeZone: 'UTC', relative: false })).toBe(
      'Sun 18 Oct, 18:00 UTC',
    );
  });

  it('says it is starting now within a minute of the time', () => {
    const near = (offset: number) =>
      formatScheduledAt(SCHEDULED, SCHEDULED + offset, inZone('UTC')).split(' · ')[1];
    expect(near(-20_000)).toBe('starting now');
    expect(near(0)).toBe('starting now');
    expect(near(20_000)).toBe('just started');
  });
});

describe('scheduledParts', () => {
  const SCHEDULED = Date.UTC(2026, 9, 18, 18, 0); // Sunday 18 Oct 2026, 18:00 UTC
  const HOUR = 60 * 60 * 1000;

  it('splits the date from how far away it is', () => {
    expect(scheduledParts(SCHEDULED, SCHEDULED - 2 * HOUR, { timeZone: 'Europe/Paris' })).toEqual({
      date: 'Sun 18 Oct, 20:00 CEST',
      relative: 'in 2 h',
    });
    expect(scheduledParts(SCHEDULED, SCHEDULED + 3 * HOUR, { timeZone: 'UTC' })).toEqual({
      date: 'Sun 18 Oct, 18:00 UTC',
      relative: 'started 3 h ago',
    });
  });

  it('has no relative part when it is left out', () => {
    expect(scheduledParts(SCHEDULED, SCHEDULED - HOUR, { timeZone: 'UTC', relative: false })).toEqual({
      date: 'Sun 18 Oct, 18:00 UTC',
      relative: null,
    });
  });

  it('is what formatScheduledAt joins', () => {
    for (const relative of [true, false]) {
      const options = { timeZone: 'Pacific/Auckland', relative };
      const { date, relative: far } = scheduledParts(SCHEDULED, SCHEDULED - 30 * HOUR, options);
      expect(formatScheduledAt(SCHEDULED, SCHEDULED - 30 * HOUR, options)).toBe(
        far === null ? date : `${date} · ${far}`,
      );
    }
  });
});

describe('scheduledDay', () => {
  it('names the weekday, day, month and year with no time', () => {
    expect(scheduledDay(Date.UTC(2026, 9, 18, 18, 0), { timeZone: 'UTC' })).toBe('Sunday 18 October 2026');
  });

  it('is the day in the given time zone: shortly after midnight in Paris is still the day before in New York', () => {
    const afterMidnightInParis = Date.UTC(2026, 9, 18, 1, 30); // Sun 18 Oct 03:30 CEST, Sat 17 Oct 21:30 EDT
    expect(scheduledDay(afterMidnightInParis, { timeZone: 'Europe/Paris' })).toBe('Sunday 18 October 2026');
    expect(scheduledDay(afterMidnightInParis, { timeZone: 'America/New_York' })).toBe(
      'Saturday 17 October 2026',
    );
  });
});
