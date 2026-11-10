import { describe, expect, it } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { roundExitRule } from '../../domain/tournament/room-exits';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import { rosterFor, testRuntime } from '../../domain/tournament/__tests__/test-fixtures';
import { stripeTone, type StripeTone } from '../tournament/components/result-row';
import { advanceResult } from './room-row-result';

/**
 * In a room, two different destinations never look the same: the Bracket has three colours for destinations
 * (green, yellow, purple) and a grey for a ranking room. Checked on the built-in upper and lower bracket (every
 * shape it takes), where a column of rounds shares its destinations' colours.
 */

type Setup = Parameters<typeof createDefaultSetup>[0];

const QUAL: Setup = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' };
const TEAMS: Setup = { gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table' };
const SWISS: Setup = { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye' };

function built(count: number, setup: Setup): TournamentState | null {
  const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
  return result.status === 'generated' ? { ...result.state, started: true } : null;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CASES: Array<[string, Setup, number[]]> = [
  ['FFA', QUAL, [...range(12, 16), ...range(24, 32)]],
  ['2v2v2v2', TEAMS, [...range(6, 8), ...range(12, 16)]],
  ['1v1 Swiss', SWISS, [8]],
];

/** Per room of every bracket round: the tone each destination reads, and a failure message for any two sharing one. */
function toneClashes(state: TournamentState): { clashes: string[]; destinations: number } {
  const clashes: string[] = [];
  let destinations = 0;
  state.rounds.forEach((round, roundIndex) => {
    const rule = roundExitRule(state, roundIndex);
    if (!round.isWaterfall || rule.kind !== 'per-room') return;
    rule.rooms.forEach((bands, room) => {
      const toneOf = new Map<number, StripeTone | null>();
      for (const band of bands) {
        if (band.kind === 'advance') toneOf.set(band.destination, stripeTone(advanceResult(band)));
      }
      destinations += toneOf.size;
      const seen = new Map<StripeTone | null, number>();
      for (const [destination, tone] of toneOf) {
        const other = seen.get(tone);
        if (other !== undefined) {
          clashes.push(
            `${round.customLabel} room ${room + 1}: rounds ${other} and ${destination} both read ${tone}`,
          );
        }
        seen.set(tone, destination);
      }
    });
  });
  return { clashes, destinations };
}

describe('two destinations of one room never share a tone (built-in upper and lower bracket)', () => {
  it.each(CASES)('%s', (_name, setup, counts) => {
    let generated = 0;
    for (const count of counts) {
      const state = built(count, setup);
      if (!state) continue;
      generated += 1;
      const { clashes, destinations } = toneClashes(state);
      expect(destinations, `${count}`).toBeGreaterThan(0);
      expect(clashes, `${count}`).toEqual([]);
    }
    expect(generated).toBeGreaterThan(0);
  });
});
