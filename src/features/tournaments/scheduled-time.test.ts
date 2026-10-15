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
  const OCTOBER = Date.UTC(2026, 9, 18, 18, 0);
  const DECEMBER = Date.UTC(2026, 11, 5, 19, 0);

  it('names the time zone at the given moment', () => {
    expect(timeZoneLabel(OCTOBER, 'Europe/Stockholm')).toBe('CEST');
    expect(timeZoneLabel(DECEMBER, 'Europe/Stockholm')).toBe('CET');
    expect(timeZoneLabel(OCTOBER, 'UTC')).toBe('UTC');
  });

  it('takes a lettered name from British or American English, whichever has one', () => {
    expect(timeZoneLabel(OCTOBER, 'Europe/London')).toBe('BST');
    expect(timeZoneLabel(DECEMBER, 'Europe/London')).toBe('GMT');
    expect(timeZoneLabel(OCTOBER, 'America/New_York')).toBe('EDT');
  });

  it('falls back to the GMT offset when no lettered name exists', () => {
    expect(timeZoneLabel(OCTOBER, 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(timeZoneLabel(OCTOBER, 'America/Sao_Paulo')).toBe('GMT-3');
  });

  it('names the browser zone without a zone given', () => {
    expect(timeZoneLabel(OCTOBER)).not.toBe('');
  });
});
