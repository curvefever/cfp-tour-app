import { describe, expect, it } from 'vitest';
import { roundNoteLines } from './round-note-lines';

describe('roundNoteLines', () => {
  it('drops blank lines and keeps one entry per line', () => {
    expect(roundNoteLines('Target score: high\n\n  \nMap: large\r\n')).toEqual([
      [{ kind: 'text', text: 'Target score: high' }],
      [{ kind: 'text', text: 'Map: large' }],
    ]);
    expect(roundNoteLines('  \n')).toEqual([]);
  });

  it('parses **bold** per line', () => {
    expect(roundNoteLines('Target **60**')).toEqual([
      [
        { kind: 'text', text: 'Target ' },
        { kind: 'bold', text: '60' },
      ],
    ]);
  });

  it('keeps raw HTML as text', () => {
    expect(roundNoteLines('<b>hi</b>')).toEqual([[{ kind: 'text', text: '<b>hi</b>' }]]);
  });
});
