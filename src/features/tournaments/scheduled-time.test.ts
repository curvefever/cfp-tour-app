import { describe, expect, it } from 'vitest';
import { fromDateTimeLocalValue, timeZoneLabel, toDateTimeLocalValue } from './scheduled-time';

describe('toDateTimeLocalValue / fromDateTimeLocalValue', () => {
  it('round-trips a time to the minute, in whatever time zone the machine is in', () => {
    const ms = new Date(2026, 9, 18, 20, 5).getTime();
    expect(toDateTimeLocalValue(ms)).toBe('2026-10-18T20:05');
    expect(fromDateTimeLocalValue('2026-10-18T20:05')).toBe(ms);
  });

  it('pads single-digit months, days and hours', () => {
    expect(toDateTimeLocalValue(new Date(2026, 0, 3, 4, 7).getTime())).toBe('2026-01-03T04:07');
  });

  it('has an empty value for no time, and no time for an empty or invalid one', () => {
    expect(toDateTimeLocalValue(null)).toBe('');
    expect(fromDateTimeLocalValue('')).toBeNull();
    expect(fromDateTimeLocalValue('not a date')).toBeNull();
  });
});

describe('timeZoneLabel', () => {
  it('names the time zone at the given moment', () => {
    expect(timeZoneLabel(Date.UTC(2026, 9, 18, 18, 0), 'en-GB')).not.toBe('');
  });
});
