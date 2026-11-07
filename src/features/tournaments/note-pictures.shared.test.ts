import { describe, expect, it } from 'vitest';
import { marshalForFirebase } from '../sync/firebase-marshal';
import {
  copyableNotePictures,
  MAX_NOTE_PICTURES,
  notePictureCount,
  notePicturesAfterRemoval,
  notePicturesAfterRename,
  notePicturesOf,
  storedNotePictures,
  validateNotePictureRenames,
  validateNotePictureSlot,
  validateNotePicturesCopyInput,
  validateNotePictureUpload,
  withNotePicture,
  withNotePicturesAdded,
  withoutNotePicture,
} from './note-pictures.shared';

const id = (n: number) => `image${String(n).padStart(8, '0')}`;

/** `count` pictures in boxes of `Round 1`, `Round 2`… (up to 9 boxes each, the round box first). */
function filled(count: number) {
  const slots = ['round', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9'];
  const pictures: Record<string, Record<string, string>> = {};
  for (let n = 0; n < count; n++) {
    const round = `Round ${Math.floor(n / slots.length) + 1}`;
    pictures[round] = { ...pictures[round], [slots[n % slots.length]]: id(n + 1) };
  }
  return storedNotePictures(pictures);
}

const dataUrl = (bytes: number) => `data:image/webp;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;

describe('validateNotePictureSlot', () => {
  const ok = { tournamentId: 't1', roundName: 'Group A (2)', slot: 'g3' };

  it('accepts a round name with spaces and brackets and the round or g1-g9 boxes', () => {
    expect(validateNotePictureSlot(ok)).toEqual(ok);
    for (const slot of ['round', 'g1', 'g9']) {
      expect(validateNotePictureSlot({ ...ok, slot })).toEqual({ ...ok, slot });
    }
  });

  it('refuses a box that is not round or g1-g9', () => {
    for (const slot of ['g10', 'g0', 'round2', 'Round', '', 'g1/g2', 5 as never]) {
      expect(() => validateNotePictureSlot({ ...ok, slot })).toThrow('Invalid settings box.');
    }
  });

  it('refuses a round name with a character a key cannot hold, an empty one or one over 60 characters', () => {
    for (const roundName of ['Round 6.1', 'a/b', 'a#b', '', 'x'.repeat(61), 7 as never]) {
      expect(() => validateNotePictureSlot({ ...ok, roundName })).toThrow('Invalid round name.');
    }
    expect(validateNotePictureSlot({ ...ok, roundName: 'x'.repeat(60) }).roundName).toHaveLength(60);
  });

  it('refuses a bad tournament id and a missing input', () => {
    expect(() => validateNotePictureSlot({ ...ok, tournamentId: 'a/b' })).toThrow('Invalid tournament ID.');
    expect(() => validateNotePictureSlot(null as never)).toThrow('Invalid settings picture.');
  });
});

describe('validateNotePictureUpload', () => {
  const slot = { tournamentId: 't1', roundName: 'Final', slot: 'round' };

  it('accepts an image and names it a picture in its messages', () => {
    const input = { ...slot, dataUrl: dataUrl(1000) };
    expect(validateNotePictureUpload(input)).toEqual(input);
    expect(() => validateNotePictureUpload({ ...slot, dataUrl: 'https://example.com/a.png' })).toThrow(
      'The picture must be a WebP, PNG or JPEG image.',
    );
    expect(() => validateNotePictureUpload({ ...slot, dataUrl: dataUrl(500 * 1024) })).toThrow(
      'The picture is too large',
    );
  });
});

describe('validateNotePicturesCopyInput', () => {
  it('needs two different, valid tournament ids', () => {
    expect(validateNotePicturesCopyInput({ fromTournamentId: 'a', toTournamentId: 'b' })).toEqual({
      fromTournamentId: 'a',
      toTournamentId: 'b',
    });
    expect(() => validateNotePicturesCopyInput({ fromTournamentId: 'a', toTournamentId: 'a' })).toThrow(
      'onto itself',
    );
    expect(() => validateNotePicturesCopyInput({ fromTournamentId: 'a/b', toTournamentId: 'b' })).toThrow(
      'Invalid tournament ID.',
    );
  });
});

describe('notePicturesOf', () => {
  it('reads a stored map, an empty marker or nothing', () => {
    const stored = storedNotePictures({ Final: { round: id(1), g2: id(2) }, 'Round 1': { g1: id(3) } });
    expect(notePicturesOf(stored)).toEqual({ Final: { round: id(1), g2: id(2) }, 'Round 1': { g1: id(3) } });
    expect(notePicturesOf(marshalForFirebase({}))).toEqual({});
    expect(notePicturesOf(null)).toEqual({});
    expect(notePicturesOf(['a'])).toEqual({});
    expect(notePicturesOf('text')).toEqual({});
  });

  it('ignores malformed values: a bad box, an id that could leave the media path, a name with a dot', () => {
    const stored = {
      Final: { round: id(1), g10: id(2), g1: '../other/12345678', g2: 5, g3: null },
      'Round 6.1': { round: id(3) },
      [`${'x'.repeat(61)}`]: { round: id(4) },
      Bad: 'nope',
      AlsoBad: ['a'],
      Empty: {},
    };
    expect(notePicturesOf(stored)).toEqual({ Final: { round: id(1) } });
  });
});

describe('withNotePicture and the limit', () => {
  it('adds a picture to an empty map, a new round or a new box, and does not change what it was given', () => {
    const stored = storedNotePictures({ Final: { round: id(1) } });
    const before = structuredClone(stored);
    expect(withNotePicture(null, 'Final', 'round', id(1))).toEqual({
      pictures: { Final: { round: id(1) } },
    });
    expect(withNotePicture(stored, 'Final', 'g2', id(2))?.pictures).toEqual({
      Final: { round: id(1), g2: id(2) },
    });
    expect(withNotePicture(stored, 'Semis', 'round', id(3))?.pictures).toEqual({
      Final: { round: id(1) },
      Semis: { round: id(3) },
    });
    expect(stored).toEqual(before);
  });

  it('accepts the 24th picture and refuses the 25th', () => {
    expect(MAX_NOTE_PICTURES).toBe(24);
    const twentyThree = filled(23);
    const twentyFour = withNotePicture(twentyThree, 'Round 3', 'g9', id(24));
    expect(twentyFour && notePictureCount(twentyFour.pictures)).toBe(24);
    expect(withNotePicture(filled(24), 'Round 3', 'g9', id(25))).toBeUndefined();
    expect(withNotePicture(filled(24), 'Final', 'round', id(25))).toBeUndefined();
  });

  it('accepts a replacement at 24 and returns the old id', () => {
    const full = filled(24);
    const change = withNotePicture(full, 'Round 1', 'g1', id(99));
    expect(change?.replaced).toBe(id(2));
    expect(change && notePictureCount(change.pictures)).toBe(24);
    expect(change?.pictures['Round 1'].g1).toBe(id(99));
  });
});

describe('withoutNotePicture', () => {
  it('empties a box and returns its image id, dropping a round left without pictures', () => {
    const stored = storedNotePictures({ Final: { round: id(1), g1: id(2) }, Semis: { round: id(3) } });
    expect(withoutNotePicture(stored, 'Final', 'g1')).toEqual({
      pictures: { Final: { round: id(1) }, Semis: { round: id(3) } },
      replaced: id(2),
    });
    expect(withoutNotePicture(stored, 'Semis', 'round').pictures).toEqual({
      Final: { round: id(1), g1: id(2) },
    });
  });

  it('changes nothing, and returns no id, for an empty box', () => {
    const stored = storedNotePictures({ Final: { round: id(1) } });
    expect(withoutNotePicture(stored, 'Final', 'g1')).toEqual({ pictures: { Final: { round: id(1) } } });
    expect(withoutNotePicture(stored, 'Nowhere', 'round')).toEqual({ pictures: { Final: { round: id(1) } } });
  });

  it('leaves an empty marker for the last picture', () => {
    const { pictures } = withoutNotePicture(
      storedNotePictures({ Final: { round: id(1) } }),
      'Final',
      'round',
    );
    expect(storedNotePictures(pictures)).toEqual(marshalForFirebase({}));
  });
});

describe('notePicturesAfterRemoval', () => {
  it('writes the map without the box and returns the image to delete', () => {
    const stored = storedNotePictures({ Final: { round: id(1), g3: id(2) } });
    const step = notePicturesAfterRemoval(stored, 'Final', 'g3');
    expect(step.removed).toBe(id(2));
    expect(step.value).toEqual(storedNotePictures({ Final: { round: id(1) } }));
  });

  it('never aborts: a transaction whose first call sees null has to be retried with the real value', () => {
    const first = notePicturesAfterRemoval(null, 'Final', 'g3');
    expect(first).toEqual({ value: null });
    const stored = storedNotePictures({ Final: { g3: id(2) } });
    expect(notePicturesAfterRemoval(stored, 'Final', 'g1').value).toBe(stored);
    expect(notePicturesAfterRemoval(undefined, 'Final', 'g1').value).toBeNull();
  });
});

describe('validateNotePictureRenames', () => {
  const ok = {
    tournamentId: 't1',
    renames: [
      { from: 'Round 4', to: 'Round 5' },
      { from: 'Round 5', to: 'Round 6' },
    ],
  };

  it('accepts a list of renames, an empty one too', () => {
    expect(validateNotePictureRenames(ok)).toEqual(ok);
    expect(validateNotePictureRenames({ ...ok, renames: [] }).renames).toEqual([]);
  });

  it('refuses a round name a key cannot hold or over 60 characters, as the other functions do', () => {
    for (const bad of ['Round 6.1', 'a/b', '', 'x'.repeat(61), 7 as never]) {
      expect(() => validateNotePictureRenames({ ...ok, renames: [{ from: 'Round 4', to: bad }] })).toThrow(
        'Invalid round name.',
      );
      expect(() => validateNotePictureRenames({ ...ok, renames: [{ from: bad, to: 'Round 5' }] })).toThrow(
        'Invalid round name.',
      );
    }
    const long = 'x'.repeat(60);
    expect(
      validateNotePictureRenames({ ...ok, renames: [{ from: long, to: 'Round 5' }] }).renames,
    ).toHaveLength(1);
  });

  it('refuses a bad tournament id, a missing input, a rename to the same name, a repeated name and too many renames', () => {
    expect(() => validateNotePictureRenames({ ...ok, tournamentId: 'a/b' })).toThrow(
      'Invalid tournament ID.',
    );
    expect(() => validateNotePictureRenames(null as never)).toThrow('Invalid rename.');
    expect(() => validateNotePictureRenames({ ...ok, renames: 'Round 4' as never })).toThrow(
      'Invalid rename.',
    );
    expect(() => validateNotePictureRenames({ ...ok, renames: [null as never] })).toThrow('Invalid rename.');
    const same = [{ from: 'Round 4', to: 'Round 4' }];
    expect(() => validateNotePictureRenames({ ...ok, renames: same })).toThrow('Invalid rename.');
    const twice = [
      { from: 'Round 4', to: 'Round 5' },
      { from: 'Round 4', to: 'Round 6' },
    ];
    expect(() => validateNotePictureRenames({ ...ok, renames: twice })).toThrow('Invalid rename.');
    const sameTarget = [
      { from: 'Round 4', to: 'Round 6' },
      { from: 'Round 5', to: 'Round 6' },
    ];
    expect(() => validateNotePictureRenames({ ...ok, renames: sameTarget })).toThrow('Invalid rename.');
    const many = Array.from({ length: 101 }, (_, n) => ({ from: `A${n}`, to: `B${n}` }));
    expect(() => validateNotePictureRenames({ ...ok, renames: many })).toThrow('Invalid rename.');
  });
});

describe('notePicturesAfterRename', () => {
  const shift = [
    { from: 'Round 4', to: 'Round 5' },
    { from: 'Round 5', to: 'Round 6' },
  ];

  it('moves every box of a renamed round with it, all at once, and leaves the other rounds', () => {
    const stored = storedNotePictures({
      'Round 4': { round: id(1), g1: id(2) },
      'Round 5': { round: id(3) },
      'Round 4 - Upper': { round: id(4) },
      Final: { g2: id(5) },
    });
    const step = notePicturesAfterRename(stored, shift);
    expect(step.dropped).toEqual([]);
    expect(notePicturesOf(step.value)).toEqual({
      'Round 5': { round: id(1), g1: id(2) },
      'Round 6': { round: id(3) },
      'Round 4 - Upper': { round: id(4) },
      Final: { g2: id(5) },
    });
  });

  it('keeps the count of pictures, whatever the move', () => {
    const stored = filled(23);
    const step = notePicturesAfterRename(stored, [{ from: 'Round 1', to: 'Round 9' }]);
    expect(notePictureCount(notePicturesOf(step.value))).toBe(23);
  });

  it('never returns undefined: null, undefined and a map with nothing to move come back as they are', () => {
    expect(notePicturesAfterRename(null, shift)).toEqual({ value: null, dropped: [] });
    expect(notePicturesAfterRename(undefined, shift)).toEqual({ value: null, dropped: [] });
    const stored = storedNotePictures({ Final: { g3: id(2) } });
    expect(notePicturesAfterRename(stored, shift).value).toBe(stored);
    expect(notePicturesAfterRename(stored, []).value).toBe(stored);
    for (const input of [null, undefined, {}, 'x', stored]) {
      expect(notePicturesAfterRename(input, shift).value).not.toBeUndefined();
    }
  });

  it('keeps the picture a name outside the renames already holds in a box, and drops the moved one (its image to delete)', () => {
    const stored = storedNotePictures({
      'Round 4': { round: id(1), g1: id(2) },
      'Round 9': { round: id(3) },
    });
    const step = notePicturesAfterRename(stored, [{ from: 'Round 4', to: 'Round 9' }]);
    expect(step.dropped).toEqual([id(1)]);
    expect(notePicturesOf(step.value)).toEqual({ 'Round 9': { round: id(3), g1: id(2) } });
  });
});

describe('withNotePicturesAdded and copyableNotePictures', () => {
  const entry = (roundName: string, slot: string, n: number) => ({ roundName, slot, imageId: id(n) });

  it('fills only empty boxes and says which entries it applied', () => {
    const stored = storedNotePictures({ Final: { round: id(1) } });
    const result = withNotePicturesAdded(stored, [entry('Final', 'round', 5), entry('Final', 'g1', 6)]);
    expect(result?.applied).toEqual([entry('Final', 'g1', 6)]);
    expect(result?.pictures).toEqual({ Final: { round: id(1), g1: id(6) } });
  });

  it('refuses to go over the limit', () => {
    expect(
      withNotePicturesAdded(filled(23), [entry('Final', 'round', 90), entry('Final', 'g1', 91)]),
    ).toBeUndefined();
    expect(withNotePicturesAdded(filled(23), [entry('Final', 'round', 90)])?.applied).toHaveLength(1);
  });

  it('copies into empty boxes only, in order, as many as the limit leaves room for', () => {
    const source = { Final: { round: id(1), g1: id(2) }, 'Round 1': { g1: id(3), g2: id(4) } };
    const target = { Final: { round: id(50) } };
    expect(copyableNotePictures(source, target).map((e) => `${e.roundName}/${e.slot}`)).toEqual([
      'Final/g1',
      'Round 1/g1',
      'Round 1/g2',
    ]);
    const nearlyFull = notePicturesOf(filled(22));
    expect(copyableNotePictures(source, nearlyFull)).toHaveLength(2);
    expect(copyableNotePictures(source, notePicturesOf(filled(24)))).toEqual([]);
  });
});
