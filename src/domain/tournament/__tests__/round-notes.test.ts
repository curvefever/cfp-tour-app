import { describe, expect, it } from 'vitest';
import { roundNote, roundNoteRows, roundNoteStage, setRoundNote } from '../round-notes';
import { createDefaultSetup } from '../state-defaults';
import type { RoundNoteStage, RoundNotes, TournamentRound, TournamentState } from '../types';
import { QUAL_GRAPH } from './qual-waterfall';
import { generated, type Setup } from './test-fixtures';

const stagesOf = (state: TournamentState): RoundNoteStage[] => state.rounds.map(roundNoteStage);

const countOf = (stages: RoundNoteStage[], stage: RoundNoteStage): number =>
  stages.filter((entry) => entry === stage).length;

const HEAD_TO_HEAD: Setup = { gameFormat: 'individual-1v1' };
const WATERFALL: Setup = {
  scheduleLogic: 'waterfall-bracket',
  waterfallGraph: QUAL_GRAPH,
  qualAdv: '99',
};

describe('roundNoteStage', () => {
  it('single elimination after a qualification table at 37: pooling, bracket, Semis, Final', () => {
    const stages = stagesOf(generated(37, { qualAdv: '30' }));
    expect(stages.slice(0, 3)).toEqual(['pooling', 'pooling', 'pooling']);
    expect(stages.slice(3, -2).length).toBeGreaterThan(0);
    expect(stages.slice(3, -2).every((stage) => stage === 'bracket')).toBe(true);
    expect(stages.slice(-2)).toEqual(['semis', 'final']);
  });

  it('Swiss rounds at 43 are pooling', () => {
    const stages = stagesOf(generated(43, { ...HEAD_TO_HEAD, poolingPhase: 'swiss', qualAdv: '16' }));
    expect(countOf(stages, 'pooling')).toBeGreaterThanOrEqual(3);
    expect(stages.indexOf('bracket')).toBe(countOf(stages, 'pooling'));
    expect(stages.slice(-2)).toEqual(['semis', 'final']);
  });

  it('group stage rounds (head-to-head, 31) are pooling', () => {
    const stages = stagesOf(generated(31, { ...HEAD_TO_HEAD, poolingPhase: 'group-stage', qualAdv: '2' }));
    expect(countOf(stages, 'pooling')).toBeGreaterThan(0);
    expect(stages.indexOf('bracket')).toBe(countOf(stages, 'pooling'));
    expect(stages.at(-1)).toBe('final');
  });

  it('double elimination race 1v1 at 37: winners and losers rounds are bracket, the Grand Final is final', () => {
    const state = generated(37, { ...HEAD_TO_HEAD, scheduleLogic: 'double-elimination' });
    const stages = stagesOf(state);
    expect(state.rounds.at(-1)?.bracket).toBe('grand-final');
    expect(stages.at(-1)).toBe('final');
    expect(countOf(stages, 'final')).toBe(1);
    expect(countOf(stages, 'semis')).toBe(0);
    const losers = state.rounds.filter((round) => round.bracket === 'losers');
    expect(losers.length).toBeGreaterThan(0);
    expect(losers.every((round) => roundNoteStage(round) === 'bracket')).toBe(true);
  });

  it('shared-final double elimination FFA at 53 ends in one final round', () => {
    const stages = stagesOf(generated(53, { scheduleLogic: 'double-elimination-shared-final' }));
    expect(countOf(stages, 'pooling')).toBe(3);
    expect(countOf(stages, 'final')).toBe(1);
    expect(stages.at(-1)).toBe('final');
  });

  it('Kings Valley at 43: no Kings Valley round is pooling', () => {
    const state = generated(43, { scheduleLogic: 'kings-valley' });
    const kingsValley = state.rounds.filter((round) => round.isKingsValley);
    expect(kingsValley.length).toBeGreaterThan(0);
    expect(kingsValley.every((round) => roundNoteStage(round) !== 'pooling')).toBe(true);
    expect(countOf(stagesOf(state), 'pooling')).toBe(3);
  });

  it('a waterfall behind a qualification table: qualification is pooling, every waterfall round is bracket, even its Final', () => {
    const state = generated(37, WATERFALL);
    const waterfall = state.rounds.filter((round) => round.isWaterfall);
    expect(waterfall.map((round) => round.customLabel)).toEqual(['R1', 'R1C', 'R2', 'Final']);
    expect(waterfall.some((round) => round.isFinal)).toBe(true);
    expect(waterfall.every((round) => roundNoteStage(round) === 'bracket')).toBe(true);
    expect(countOf(stagesOf(state), 'pooling')).toBe(3);
  });

  it('poolingPhase none: its two warm-up rounds are pooling', () => {
    const state = generated(37, { poolingPhase: 'none' });
    expect(state.rounds.slice(0, 2).every((round) => round.isNoElim)).toBe(true);
    expect(countOf(stagesOf(state), 'pooling')).toBe(2);
    expect(stagesOf(state).slice(0, 2)).toEqual(['pooling', 'pooling']);
  });
});

const round = (overrides: Partial<TournamentRound> = {}): TournamentRound => ({
  roundNum: 1,
  players: 8,
  rooms: [8],
  byeCount: 0,
  isQual: false,
  isNoElim: false,
  isSemis: false,
  isFinal: false,
  advPerRoom: null,
  advTotal: 0,
  luckyCount: 0,
  ...overrides,
});

const waterfallRound = (label: string, overrides: Partial<TournamentRound> = {}) =>
  round({ isWaterfall: true, customLabel: label, ...overrides });

describe('roundNote', () => {
  it('takes the label note, then the stage note, then the bracket note for Semis and Final, then none', () => {
    const notes: RoundNotes = {
      stages: { bracket: 'B', semis: 'S', final: 'F' },
      rounds: { R1: 'own' },
    };
    expect(roundNote(notes, waterfallRound('R1'))).toBe('own');
    expect(roundNote(notes, round({ isSemis: true }))).toBe('S');
    expect(roundNote(notes, round({ isFinal: true }))).toBe('F');
    expect(roundNote({ stages: { bracket: 'B' } }, round({ isSemis: true }))).toBe('B');
    expect(roundNote({ stages: { bracket: 'B' } }, round({ isFinal: true }))).toBe('B');
    expect(roundNote({ stages: { bracket: 'B' } }, round())).toBe('B');
    expect(roundNote({ stages: { semis: 'S' } }, round())).toBe('');
    expect(roundNote({ stages: { final: 'F' } }, round({ isSemis: true }))).toBe('');
    expect(roundNote({ stages: { pooling: 'P' } }, round({ isNoElim: true }))).toBe('P');
    expect(roundNote(undefined, round())).toBe('');
  });

  it('treats a whitespace-only note as none and falls through to the next one', () => {
    const notes: RoundNotes = { stages: { bracket: 'B', final: '  \n ' }, rounds: { R1: '   ' } };
    expect(roundNote(notes, round({ isFinal: true }))).toBe('B');
    expect(roundNote(notes, waterfallRound('R1'))).toBe('B');
    expect(roundNote({ stages: { pooling: ' ' } }, round({ isNoElim: true }))).toBe('');
  });

  it('a waterfall round named "Final" reads its label note, never the final stage note', () => {
    const stages: RoundNotes['stages'] = { final: 'stage final', bracket: 'bracket' };
    const finalRound = waterfallRound('Final', { isFinal: true });
    expect(roundNote({ stages, rounds: { Final: 'label final' } }, finalRound)).toBe('label final');
    expect(roundNote({ stages }, finalRound)).toBe('bracket');
  });

  it('a non-waterfall round never reads a label note', () => {
    expect(roundNote({ rounds: { R1: 'x' } }, round({ customLabel: 'R1' }))).toBe('');
  });

  describe("the organiser's example: normal target score in pooling, high after it", () => {
    const notes: RoundNotes = {
      stages: { pooling: 'Target score: normal', bracket: 'Target score: high' },
    };

    it.each([37, 53])(
      'at %i players every pooling round is normal, every other round (Semis and Final included) high',
      (count) => {
        const state = generated(count, { qualAdv: '30' });
        const shown = state.rounds.map((entry) => roundNote(notes, entry));
        expect(shown.slice(0, 3)).toEqual(Array(3).fill('Target score: normal'));
        expect(shown.slice(3).length).toBeGreaterThan(2);
        expect(shown.slice(3).every((note) => note === 'Target score: high')).toBe(true);
        expect(state.rounds.some((entry) => entry.isSemis)).toBe(true);
        expect(state.rounds.at(-1)?.isFinal).toBe(true);
      },
    );
  });
});

describe('roundNoteRows', () => {
  const namesFor = (setup: Setup) =>
    roundNoteRows(createDefaultSetup(setup), undefined).map((row) => row.name);
  const waterfallSetup = (waterfallGraph: string) =>
    createDefaultSetup({ scheduleLogic: 'waterfall-bracket', poolingPhase: 'qual-table', waterfallGraph });

  it('single elimination: pooling, bracket, Semis, Final', () => {
    expect(namesFor({ poolingPhase: 'qual-table' })).toEqual([
      'Qualification rounds',
      'Bracket rounds',
      'Semis',
      'Final',
    ]);
  });

  it('names the pooling row after the pooling phase, warm-up rounds included', () => {
    expect(namesFor({ poolingPhase: 'swiss' })[0]).toBe('Swiss rounds');
    expect(namesFor({ poolingPhase: 'group-stage' })[0]).toBe('Group stage rounds');
    expect(namesFor({ poolingPhase: 'none' })[0]).toBe('Warm-up rounds');
  });

  it.each(['double-elimination', 'double-elimination-shared-final', 'kings-valley'] as const)(
    '%s: no Semis row',
    (scheduleLogic) => {
      expect(namesFor({ poolingPhase: 'qual-table', scheduleLogic })).toEqual([
        'Qualification rounds',
        'Bracket rounds',
        'Final',
      ]);
    },
  );

  it('a waterfall: other bracket rounds, then one row per label in graph order, no Final stage row', () => {
    const rows = roundNoteRows(waterfallSetup(QUAL_GRAPH), undefined);
    expect(rows.map((row) => row.name)).toEqual([
      'Qualification rounds',
      'Other bracket rounds',
      'R1',
      'R1C',
      'R2',
      'Final',
    ]);
    expect(rows[1].hint).toBe('Every waterfall round without a note of its own');
    expect(rows[5].key).toEqual({ kind: 'round', label: 'Final' });
  });

  it('an unparseable graph gives no label rows', () => {
    const rows = roundNoteRows(waterfallSetup('R1 = nonsense'), undefined);
    expect(rows.map((row) => row.name)).toEqual(['Qualification rounds', 'Other bracket rounds']);
  });

  it('carries the stored text and lists an orphaned label note last', () => {
    const notes: RoundNotes = { stages: { pooling: 'P' }, rounds: { Gone: 'old', R1: 'first' } };
    const rows = roundNoteRows(waterfallSetup(QUAL_GRAPH), notes);
    expect(rows[0].note).toBe('P');
    expect(rows.find((row) => row.name === 'R1')?.note).toBe('first');
    expect(rows.find((row) => row.name === 'R2')?.note).toBe('');
    expect(rows.at(-1)).toEqual({
      key: { kind: 'round', label: 'Gone' },
      name: 'Gone',
      note: 'old',
      orphan: true,
    });
    expect(rows.filter((row) => row.orphan)).toHaveLength(1);
  });
});

describe('setRoundNote', () => {
  const pooling = { kind: 'stage', stage: 'pooling' } as const;
  const r1 = { kind: 'round', label: 'R1' } as const;

  it('sets and overwrites a stage note and a round note', () => {
    const first = setRoundNote(undefined, pooling, 'a');
    expect(first).toEqual({ stages: { pooling: 'a' } });
    const second = setRoundNote(first, r1, 'b');
    expect(second).toEqual({ stages: { pooling: 'a' }, rounds: { R1: 'b' } });
    expect(setRoundNote(second, pooling, ' c ')).toEqual({
      stages: { pooling: 'c' },
      rounds: { R1: 'b' },
    });
  });

  it('blank text deletes the note and drops an emptied map', () => {
    const both: RoundNotes = { stages: { pooling: 'a' }, rounds: { R1: 'b' } };
    expect(setRoundNote(both, pooling, '  \n')).toEqual({ rounds: { R1: 'b' } });
    expect(setRoundNote(both, r1, '')).toEqual({ stages: { pooling: 'a' } });
  });

  it('removing the last note gives undefined, and blanking a missing note changes nothing', () => {
    expect(setRoundNote({ stages: { pooling: 'a' } }, pooling, '')).toBeUndefined();
    expect(setRoundNote(undefined, pooling, ' ')).toBeUndefined();
    expect(setRoundNote({ rounds: { R1: 'b' } }, pooling, '')).toEqual({ rounds: { R1: 'b' } });
  });

  it('does not change the notes it was given', () => {
    const notes: RoundNotes = { stages: { pooling: 'a' } };
    setRoundNote(notes, pooling, 'z');
    expect(notes).toEqual({ stages: { pooling: 'a' } });
  });
});
