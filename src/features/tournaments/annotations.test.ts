import { describe, expect, it } from 'vitest';
import { addAnnotation, annotationsNewestFirst, MAX_ANNOTATION_CHARS, removeAnnotation } from './annotations';

const note = (text: string, timestamp: string) => ({ text, timestamp });

describe('addAnnotation', () => {
  it('appends a trimmed note with its time', () => {
    const notes = [note('first', '2026-10-18T20:00:00.000Z')];
    expect(addAnnotation(notes, '  Room 3 replayed  ', '2026-10-18T21:00:00.000Z')).toEqual([
      note('first', '2026-10-18T20:00:00.000Z'),
      note('Room 3 replayed', '2026-10-18T21:00:00.000Z'),
    ]);
    expect(notes).toHaveLength(1);
  });

  it('adds nothing for an empty note or one over the limit', () => {
    expect(addAnnotation([], '   ', 't')).toEqual([]);
    expect(addAnnotation([], 'x'.repeat(MAX_ANNOTATION_CHARS + 1), 't')).toEqual([]);
    expect(addAnnotation([], 'x'.repeat(MAX_ANNOTATION_CHARS), 't')).toHaveLength(1);
  });
});

describe('removeAnnotation', () => {
  it('drops the note at the position and keeps the others in order', () => {
    const notes = [note('a', '1'), note('b', '2'), note('c', '3')];
    expect(removeAnnotation(notes, 1)).toEqual([note('a', '1'), note('c', '3')]);
  });

  it('empties a list of one', () => {
    expect(removeAnnotation([note('a', '1')], 0)).toEqual([]);
  });
});

describe('annotationsNewestFirst', () => {
  it('lists the most recent note first, each with its stored position', () => {
    const listed = annotationsNewestFirst([
      note('old', '2026-10-18T20:00:00.000Z'),
      note('new', '2026-10-18T22:00:00.000Z'),
      note('middle', '2026-10-18T21:00:00.000Z'),
    ]);
    expect(listed.map((entry) => [entry.text, entry.position])).toEqual([
      ['new', 1],
      ['middle', 2],
      ['old', 0],
    ]);
  });

  it('puts the later stored note first when two share a time', () => {
    const listed = annotationsNewestFirst([note('a', 't'), note('b', 't')]);
    expect(listed.map((entry) => entry.text)).toEqual(['b', 'a']);
  });
});
