import { describe, expect, it } from 'vitest';
import { rosterLoadStatus, scheduleReloadStatus } from './roster-status';

describe('rosterLoadStatus', () => {
  it('counts the reserves in the singular and the plural', () => {
    expect(rosterLoadStatus(37, 1)).toBe('37 registered, 1 reserve');
    expect(rosterLoadStatus(37, 0)).toBe('37 registered, 0 reserves');
  });

  it('adds the individual reserves of a team format', () => {
    expect(rosterLoadStatus(13, 2, 1)).toBe('13 registered, 2 reserves, 1 individual reserve');
  });
});

describe('scheduleReloadStatus', () => {
  it('says nothing when no schedule was generated', () => {
    expect(scheduleReloadStatus(false)).toBe('');
  });

  it('says the schedule was redrawn', () => {
    expect(scheduleReloadStatus(true)).toBe(' · schedule redrawn');
  });

  it('says the schedule was cleared, with the reason, and points at Generate', () => {
    expect(scheduleReloadStatus(true, 'This format needs at least 12 players.')).toBe(
      ' · schedule cleared: This format needs at least 12 players. Click Generate again.',
    );
  });
});
