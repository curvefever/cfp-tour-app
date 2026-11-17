import { describe, expect, it } from 'vitest';
import { generatedConfig } from '../generated-config';
import type { TournamentState } from '../types';
import { generated } from './test-fixtures';

describe('generatedConfig', () => {
  it('is the config of a generated tournament, the same object', () => {
    const state = generated(20);
    expect(generatedConfig(state)).toBe(state.gamemodeConfig);
  });

  it('is null for a tournament before Generate, and for a config with no room size', () => {
    expect(generatedConfig({ gamemodeConfig: {} })).toBeNull();
    const { roomSize: _roomSize, ...rest } = generated(20).gamemodeConfig;
    expect(generatedConfig({ gamemodeConfig: rest })).toBeNull();
  });
});
