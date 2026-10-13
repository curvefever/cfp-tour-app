import { describe, expect, it } from 'vitest';
import { MAX_SIDE, QUALITY_STEPS, SCALE_STEPS, TARGET_BYTES, fitWithin } from './image-shrink';
import { MAX_SCREENSHOT_BYTES } from '../tournaments/screenshots.shared';

describe('fitWithin', () => {
  it('brings the longest side down to the limit, keeping the proportions', () => {
    expect(fitWithin(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });

  it('leaves an image that already fits alone, and never enlarges one', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('keeps at least one pixel on each side', () => {
    expect(fitWithin(100000, 10, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('the shrink settings', () => {
  it('aim well under what the server accepts, from the best quality down', () => {
    expect(MAX_SIDE).toBe(1600);
    expect(TARGET_BYTES).toBeLessThan(MAX_SCREENSHOT_BYTES);
    expect([...QUALITY_STEPS]).toEqual([...QUALITY_STEPS].sort((a, b) => b - a));
    expect(SCALE_STEPS[0]).toBe(1);
  });
});
