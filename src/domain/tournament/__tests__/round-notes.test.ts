import { describe, expect, it } from 'vitest';
import { infoWithRoundNote, roundNote, roundNoteNames, roundNoteRows, setRoundNote } from '../round-notes';
import { createDefaultInfo } from '../state-defaults';
import type { RoundNotes, TournamentState } from '../types';
import { QUAL_GRAPH } from './qual-waterfall';
import { generated, type Setup } from './test-fixtures';

const HEAD_TO_HEAD: Setup = { gameFormat: 'individual-1v1' };
const WATERFALL: Setup = {
  scheduleLogic: 'waterfall-bracket',
  waterfallGraph: QUAL_GRAPH,
  qualAdv: '99',
};

const isUnique = (names: string[]) => new Set(names).size === names.length;

/** A note on every round of the schedule: "Powers: round <n>". */
const perRoundNotes = (state: TournamentState): RoundNotes =>
  Object.fromEntries(roundNoteNames(state).map((name, index) => [name, `Powers: round ${index + 1}`]));

describe('roundNoteNames', () => {
  const schedules: Array<[string, TournamentState]> = [
    ['single elimination after a qualification table at 37', generated(37, { qualAdv: '30' })],
    ['single elimination after a qualification table at 53', generated(53, { qualAdv: '30' })],
    ['Swiss 1v1 at 43', generated(43, { ...HEAD_TO_HEAD, poolingPhase: 'swiss', qualAdv: '16' })],
    ['group stage 1v1 at 31', generated(31, { ...HEAD_TO_HEAD, poolingPhase: 'group-stage', qualAdv: '2' })],
    [
      'double elimination race 1v1 at 37',
      generated(37, { ...HEAD_TO_HEAD, scheduleLogic: 'double-elimination' }),
    ],
    [
      'shared-final double elimination at 53',
      generated(53, { scheduleLogic: 'double-elimination-shared-final' }),
    ],
    ['Kings Valley at 43', generated(43, { scheduleLogic: 'kings-valley' })],
    ['a waterfall behind a qualification table', generated(37, WATERFALL)],
    ['no pooling phase', generated(37, { poolingPhase: 'none' })],
  ];

  it.each(schedules)('gives every round of %s its own name, in schedule order', (_name, state) => {
    const names = roundNoteNames(state);
    expect(names).toHaveLength(state.rounds.length);
    expect(isUnique(names)).toBe(true);
  });

  it("names the rounds the way the Bracket's title bars do", () => {
    expect(roundNoteNames(generated(37, { qualAdv: '30' }))).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
      'Round 6',
      'Semis',
      'Final',
    ]);
    expect(roundNoteNames(generated(37, WATERFALL)).slice(3)).toEqual(['R1', 'R1C', 'R2', 'Final']);
    const doubleElimination = roundNoteNames(
      generated(37, { ...HEAD_TO_HEAD, scheduleLogic: 'double-elimination' }),
    );
    expect(doubleElimination.some((name) => name.startsWith('WB Round'))).toBe(true);
    expect(doubleElimination.some((name) => name.startsWith('LB Round'))).toBe(true);
    expect(doubleElimination.at(-1)).toBe('Grand Final');
  });

  it('adds (2) to a name that repeats: a waterfall round named like a pooling round', () => {
    const graph = QUAL_GRAPH.replaceAll('R2', 'Round 2');
    const names = roundNoteNames(generated(37, { ...WATERFALL, waterfallGraph: graph }));
    expect(names).toEqual(['Round 1', 'Round 2', 'Round 3', 'R1', 'R1C', 'Round 2 (2)', 'Final']);
  });

  it('numbers a third repeat (3)', () => {
    const rounds = ['A', 'A', 'B', 'A'].map((customLabel) => ({ customLabel }));
    expect(roundNoteNames({ rounds } as unknown as Pick<TournamentState, 'rounds'>)).toEqual([
      'A',
      'A (2)',
      'B',
      'A (3)',
    ]);
  });
});

describe('roundNote', () => {
  it('is the trimmed note of that name, and nothing for another name', () => {
    const notes: RoundNotes = { 'Round 1': '  Powers: Ghost  ', Final: 'Target 120' };
    expect(roundNote(notes, 'Round 1')).toBe('Powers: Ghost');
    expect(roundNote(notes, 'Final')).toBe('Target 120');
    expect(roundNote(notes, 'Round 2')).toBe('');
    expect(roundNote(undefined, 'Round 1')).toBe('');
  });

  it('treats whitespace, a name of the prototype and a non-text value as no note', () => {
    const old = { stages: { pooling: 'x' }, 'Round 1': '   ' } as unknown as RoundNotes;
    expect(roundNote(old, 'Round 1')).toBe('');
    expect(roundNote(old, 'stages')).toBe('');
    expect(roundNote(old, 'constructor')).toBe('');
  });

  describe('a different note on every round', () => {
    it.each([37, 53])('at %i players each round reads its own note and none leaks', (count) => {
      const state = generated(count, { qualAdv: '30' });
      const notes = perRoundNotes(state);
      const names = roundNoteNames(state);
      expect(names.map((name) => roundNote(notes, name))).toEqual(
        names.map((_name, index) => `Powers: round ${index + 1}`),
      );
      expect(isUnique(names.map((name) => roundNote(notes, name)))).toBe(true);
    });
  });
});

describe('roundNoteRows', () => {
  it('has one row per round in schedule order, with its note or none', () => {
    const state = generated(37, { qualAdv: '30' });
    const rows = roundNoteRows(state, { 'Round 2': 'Powers: Zap', Final: 'Target 120' });
    expect(rows.map((row) => row.name)).toEqual(roundNoteNames(state));
    expect(rows.find((row) => row.name === 'Round 2')?.note).toBe('Powers: Zap');
    expect(rows.find((row) => row.name === 'Final')?.note).toBe('Target 120');
    expect(rows.find((row) => row.name === 'Round 1')?.note).toBe('');
    expect(rows.some((row) => row.orphan)).toBe(false);
  });

  it('has no rows while the schedule has no rounds, whatever is stored', () => {
    expect(roundNoteRows({ rounds: [] }, { 'Round 1': 'x' })).toEqual([]);
  });

  it('lists a stored name that no round has, last and marked, and skips blank and non-text entries', () => {
    const state = generated(31, { qualAdv: '16' });
    const stored = { Gone: 'old', Blank: '  ', stages: { pooling: 'x' } } as unknown as RoundNotes;
    const rows = roundNoteRows(state, stored);
    expect(rows.at(-1)).toEqual({ name: 'Gone', note: 'old', orphan: true });
    expect(rows.filter((row) => row.orphan)).toHaveLength(1);
  });

  describe('after a redraw', () => {
    const fewer = generated(31, { qualAdv: '16' });
    const more = generated(43, { qualAdv: '30' });

    it('keeps the note of every name the new schedule still has and starts a new round empty', () => {
      const notes = perRoundNotes(fewer);
      const rows = roundNoteRows(more, notes);
      expect(rows.map((row) => row.name)).toEqual(roundNoteNames(more));
      for (const name of roundNoteNames(fewer)) {
        expect(rows.find((row) => row.name === name)?.note).toBe(notes[name]);
      }
      expect(rows.find((row) => row.name === 'Round 5')?.note).toBe('');
      expect(rows.some((row) => row.orphan)).toBe(false);
    });

    it('lists the notes of rounds that are gone as orphans', () => {
      const notes = perRoundNotes(more);
      const rows = roundNoteRows(fewer, notes);
      expect(rows.slice(0, roundNoteNames(fewer).length).some((row) => row.orphan)).toBe(false);
      expect(rows.filter((row) => row.orphan).map((row) => row.name)).toEqual([
        'Round 4',
        'Round 5',
        'Round 6',
      ]);
      expect(rows.find((row) => row.name === 'Round 4')?.note).toBe(notes['Round 4']);
      expect(rows.find((row) => row.name === 'Final')?.note).toBe(notes.Final);
    });
  });
});

describe('setRoundNote', () => {
  it('sets, overwrites (trimmed) and keeps the other notes', () => {
    const first = setRoundNote(undefined, 'Round 1', 'a');
    expect(first).toEqual({ 'Round 1': 'a' });
    const second = setRoundNote(first, 'Final', 'b');
    expect(second).toEqual({ 'Round 1': 'a', Final: 'b' });
    expect(setRoundNote(second, 'Round 1', ' c ')).toEqual({ 'Round 1': 'c', Final: 'b' });
  });

  it('deletes the note for blank text, and gives undefined once the last one is gone', () => {
    expect(setRoundNote({ 'Round 1': 'a', Final: 'b' }, 'Round 1', '  \n')).toEqual({ Final: 'b' });
    expect(setRoundNote({ Final: 'b' }, 'Final', '')).toBeUndefined();
    expect(setRoundNote(undefined, 'Final', ' ')).toBeUndefined();
    expect(setRoundNote({ Final: 'b' }, 'Round 1', '')).toEqual({ Final: 'b' });
  });

  it('drops the entries of the old stage shape on a save', () => {
    const old = {
      stages: { pooling: 'x' },
      rounds: { R1: 'y' },
      Final: 'kept',
    } as unknown as RoundNotes;
    expect(setRoundNote(old, 'Round 1', 'a')).toEqual({ Final: 'kept', 'Round 1': 'a' });
    expect(setRoundNote(old, 'Round 1', '')).toEqual({ Final: 'kept' });
    const onlyOld = { stages: { pooling: 'x' } } as unknown as RoundNotes;
    expect(setRoundNote(onlyOld, 'Round 1', '')).toBeUndefined();
  });

  it('does not change the notes it was given', () => {
    const notes: RoundNotes = { Final: 'a' };
    setRoundNote(notes, 'Final', 'z');
    expect(notes).toEqual({ Final: 'a' });
  });
});

describe('infoWithRoundNote', () => {
  const info = {
    ...createDefaultInfo(),
    scheduledAt: 5,
    rulesText: 'No pause',
    screenshots: ['image00000001'],
  };

  it('sets a note and keeps the rest of the info', () => {
    expect(infoWithRoundNote(info, 'Round 1', 'Target score: high')).toEqual({
      ...info,
      roundNotes: { 'Round 1': 'Target score: high' },
    });
  });

  it('removes the roundNotes key itself when the last note is cleared', () => {
    const cleared = infoWithRoundNote(infoWithRoundNote(info, 'Round 1', 'a'), 'Round 1', '  ');
    expect(cleared).toEqual(info);
    expect('roundNotes' in cleared).toBe(false);
  });

  it('keeps the other notes when one is cleared', () => {
    const two = infoWithRoundNote(infoWithRoundNote(info, 'Round 1', 'a'), 'Final', 'b');
    expect(infoWithRoundNote(two, 'Round 1', '').roundNotes).toEqual({ Final: 'b' });
  });

  it('drops an old-shape map on the first save', () => {
    const old = {
      ...info,
      roundNotes: { stages: { pooling: 'x' }, rounds: { R1: 'y' } } as unknown as RoundNotes,
    };
    expect(infoWithRoundNote(old, 'Round 1', 'a').roundNotes).toEqual({ 'Round 1': 'a' });
    expect('roundNotes' in infoWithRoundNote(old, 'Round 1', '')).toBe(false);
  });
});
