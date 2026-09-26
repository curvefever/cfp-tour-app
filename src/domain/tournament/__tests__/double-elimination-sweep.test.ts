import { describe, expect, it } from 'vitest';
import type { TournamentState } from '../types';
import { buildState, playThrough, playWithRemovals, type SweepConfig } from './play-through';

/**
 * Double-elimination removal sweep: every config is played through the real
 * transition code with one unit removed on arrival at each round index before
 * the Final in turn. Every removal point must play through to the Final, and
 * a shared Final must still seat everyone it planned for. Configs that
 * generation refuses, or that fail without any removal (tie cut-offs), are
 * skipped, as in removal-sweep.test.ts.
 */

const poolings = ['none', 'qual-table'] as const;

function sharedFinalConfigs(): SweepConfig[] {
  const list: SweepConfig[] = [];
  for (const count of [17, 23, 29, 37, 43, 53]) {
    for (const poolingPhase of poolings) {
      list.push({
        label: `FFA ${count} shared Final ${poolingPhase}`,
        count,
        teams: false,
        setup: {
          gameFormat: 'ffa-individual',
          scheduleLogic: 'double-elimination-shared-final',
          poolingPhase,
        },
      });
    }
  }
  for (const gameFormat of ['team-2v2v2v2', 'team-3v3v3'] as const) {
    for (const count of [11, 13, 17]) {
      for (const poolingPhase of poolings) {
        list.push({
          label: `${gameFormat} ${count} shared Final ${poolingPhase}`,
          count,
          teams: true,
          setup: { gameFormat, scheduleLogic: 'double-elimination-shared-final', poolingPhase },
        });
      }
    }
  }
  return list;
}

function raceConfigs(): SweepConfig[] {
  const list: SweepConfig[] = [];
  for (const gameFormat of ['individual-1v1', 'team-3v3'] as const) {
    // 40 teams (14 rooms a wave, three players each) only for 1v1: it dominated the run time.
    const counts = gameFormat === 'team-3v3' ? [12, 13, 16, 19, 24, 33] : [12, 13, 16, 19, 24, 33, 40];
    for (const count of counts) {
      for (const poolingPhase of [...poolings, 'swiss'] as const) {
        for (const oddCountStrategy of ['bye', 'none', ''] as const) {
          list.push({
            label: `${gameFormat} ${count} race ${poolingPhase} strategy '${oddCountStrategy}'`,
            count,
            teams: gameFormat === 'team-3v3',
            setup: { gameFormat, scheduleLogic: 'double-elimination', poolingPhase, oddCountStrategy },
          });
        }
      }
    }
  }
  return list;
}

const teamSizeOf = (config: SweepConfig) => (config.teams ? 3 : 0);

/** The built state, or null (logged) for a config that isn't part of the sweep. */
function playableState(config: SweepConfig): TournamentState | null {
  const state = buildState(config);
  if (!state) {
    if (process.env.SWEEP_LOG) console.log(`SKIP(generation) ${config.label}`);
    return null;
  }
  const baseline = playThrough(state, teamSizeOf(config), null);
  if (baseline.kind !== 'ok') {
    if (process.env.SWEEP_LOG) console.log(`SKIP(baseline ${baseline.kind}) ${config.label}`);
    return null;
  }
  return state;
}

const describeOutcome = (outcome: ReturnType<typeof playThrough>) =>
  outcome.kind === 'ok' ? 'ok' : `${outcome.kind}: ${outcome.message}`;

/**
 * True when the play stopped on an unresolved tie at a qualification cut-off,
 * which a removal can create (it changes who is level) and which is the
 * organiser's to resolve, not a block on the removal itself: logged, not
 * asserted. Every other outcome must be a clean play-through.
 */
function stoppedOnTie(outcome: ReturnType<typeof playThrough>, label: string): boolean {
  if (outcome.kind !== 'blocked' || outcome.reason !== 'pending-ties') return false;
  if (process.env.SWEEP_LOG) console.log(`SKIP(tie after removal) ${label}`);
  return true;
}

describe('shared Final: one removal at every round index plays to a full Final', () => {
  it.each(sharedFinalConfigs().map((config) => [config.label, config] as const))(
    '%s',
    (_label, config) => {
      const start = playableState(config);
      if (!start) return;
      const finalIndex = start.rounds.length - 1;
      const finalSeats = start.rounds[finalIndex].players;
      for (let removeAt = 0; removeAt < finalIndex; removeAt += 1) {
        const played = playWithRemovals(start, teamSizeOf(config), [removeAt]);
        if (stoppedOnTie(played.outcome, `${config.label} @${removeAt}`)) continue;
        expect(describeOutcome(played.outcome), `removal at round index ${removeAt}`).toBe('ok');
        expect(
          played.state.assignments[played.state.curRound],
          `Final after a removal at ${removeAt}`,
        ).toHaveLength(finalSeats);
      }
    },
    60_000,
  );
});

describe('race: one removal at every round index plays to the Grand Final', () => {
  it.each(raceConfigs().map((config) => [config.label, config] as const))(
    '%s',
    (_label, config) => {
      const start = playableState(config);
      if (!start) return;
      const finalIndex = start.rounds.length - 1;
      for (let removeAt = 0; removeAt < finalIndex; removeAt += 1) {
        const played = playWithRemovals(start, teamSizeOf(config), [removeAt]);
        if (stoppedOnTie(played.outcome, `${config.label} @${removeAt}`)) continue;
        expect(describeOutcome(played.outcome), `removal at round index ${removeAt}`).toBe('ok');
      }
    },
    60_000,
  );
});

describe('two removals in winners-bracket rounds still play through', () => {
  const cases: Array<[SweepConfig, string]> = [
    [
      {
        label: 'FFA 23 shared Final, no pooling',
        count: 23,
        teams: false,
        setup: {
          gameFormat: 'ffa-individual',
          scheduleLogic: 'double-elimination-shared-final',
          poolingPhase: 'none',
        },
      },
      'FFA 23 shared Final, no pooling',
    ],
    [
      {
        label: 'FFA 37 shared Final, Qualification Table',
        count: 37,
        teams: false,
        setup: {
          gameFormat: 'ffa-individual',
          scheduleLogic: 'double-elimination-shared-final',
          poolingPhase: 'qual-table',
        },
      },
      'FFA 37 shared Final, Qualification Table',
    ],
    [
      {
        label: '1v1 16 race, no pooling, "None"',
        count: 16,
        teams: false,
        setup: {
          gameFormat: 'individual-1v1',
          scheduleLogic: 'double-elimination',
          poolingPhase: 'none',
          oddCountStrategy: 'none',
        },
      },
      '1v1 16 race, no pooling, "None"',
    ],
  ];

  it.each(cases)('%s', (config) => {
    const start = buildState(config) as TournamentState;
    const winners = start.rounds.flatMap((round, index) => (round.bracket === 'winners' ? [index] : []));
    const [first, second] = winners;
    const pairs = [
      ['the same first winners round', [first, first]],
      ['the same second winners round', [second, second]],
      ['one in each of the first two winners rounds', [first, second]],
    ] as const;
    for (const [what, removals] of pairs) {
      const played = playWithRemovals(start, 0, [...removals]);
      expect(describeOutcome(played.outcome), `two removals in ${what}`).toBe('ok');
    }
  });
});
