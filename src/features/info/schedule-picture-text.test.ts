import { describe, expect, it } from 'vitest';
import { matchesText, placesText, roomGroupLabel, sizesText } from './schedule-picture-text';

describe('placesText', () => {
  it('writes ordinals, with en dashes and "last"', () => {
    expect(placesText(1, 4)).toBe('1st–4th');
    expect(placesText(5, 5)).toBe('5th');
    expect(placesText(5, 'last')).toBe('5th–last');
    expect(placesText(11, 13)).toBe('11th–13th');
    expect(placesText(22, 23)).toBe('22nd–23rd');
  });
});

describe('sizesText', () => {
  it('writes players as "8p", distinct sizes largest first, "each" for several rooms of one size', () => {
    expect(sizesText([8], false)).toBe('8p');
    expect(sizesText([8, 8], false)).toBe('8p each');
    expect(sizesText([7, 8, 8], false)).toBe('8p and 7p');
    expect(sizesText([6, 8, 7], false)).toBe('8p, 7p and 6p');
  });

  it('writes teams with the noun once', () => {
    expect(sizesText([4], true)).toBe('4 teams');
    expect(sizesText([4, 4], true)).toBe('4 teams each');
    expect(sizesText([3, 4], true)).toBe('4 and 3 teams');
  });
});

describe('matchesText', () => {
  it('counts matches', () => {
    expect(matchesText(6)).toBe('6 matches');
    expect(matchesText(1)).toBe('1 match');
  });
});

describe('roomGroupLabel', () => {
  it('names a room, a run of rooms and rooms apart, with their sizes', () => {
    expect(roomGroupLabel([0], [8], false)).toBe('Room A · 8p');
    expect(roomGroupLabel([1, 2, 3], [7, 7, 7], false)).toBe('Rooms B–D · 7p each');
    expect(roomGroupLabel([1, 3], [8, 7], false)).toBe('Rooms B, D · 8p and 7p');
    expect(roomGroupLabel([0, 1], [4, 3], true)).toBe('Rooms A–B · 4 and 3 teams');
  });
});
