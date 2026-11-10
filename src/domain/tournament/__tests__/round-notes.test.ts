import { describe, expect, it } from 'vitest';
import { changeRoundMatchFormat } from '../match-format-change';
import { bestOfGameCount } from '../match-format';
import {
  MAX_GAME_BOXES,
  gameNoteRowLabel,
  infoWithGameNote,
  infoWithRenamedRounds,
  infoWithRoundNote,
  noteGameCount,
  roundNote,
  roundNoteNames,
  roundNoteRowLabel,
  roundNoteRows,
  roundSettingsByRound,
  roundSettingsOf,
  setRoundNote,
} from '../round-notes';
import { createDefaultInfo } from '../state-defaults';
import type { GameNotes, NotePictures, RoundNotes, TournamentInfo, TournamentState } from '../types';
import { QUAL_GRAPH } from './qual-waterfall';
import { buildRound, generated, type Setup } from './test-fixtures';

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
  it('keeps a double-elimination note under its stored name and shows the column name', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 8 }),
      buildRound({ roundNum: 2, rooms: [2], players: 4, bracket: 'winners' }),
      buildRound({ roundNum: 3, rooms: [2], players: 4, bracket: 'losers' }),
    ];
    const rows = roundNoteRows({ rounds, gamemodeConfig: {} }, { roundNotes: { 'LB Round 3': 'Zap only' } });
    expect(rows[2]).toEqual({ name: 'LB Round 3', shown: 'LB Round 2', note: 'Zap only', games: [] });
    expect(roundNoteRowLabel(rows[2])).toBe('LB Round 2');
    expect(rows[1]).toEqual({ name: 'WB Round 2', note: '', games: [] });
  });

  it('has one row per round in schedule order, with its note or none', () => {
    const state = generated(37, { qualAdv: '30' });
    const rows = roundNoteRows(state, { roundNotes: { 'Round 2': 'Powers: Zap', Final: 'Target 120' } });
    expect(rows.map((row) => row.name)).toEqual(roundNoteNames(state));
    expect(rows.find((row) => row.name === 'Round 2')?.note).toBe('Powers: Zap');
    expect(rows.find((row) => row.name === 'Final')?.note).toBe('Target 120');
    expect(rows.find((row) => row.name === 'Round 1')?.note).toBe('');
    expect(rows.some((row) => row.orphan)).toBe(false);
  });

  it('has no rows while the schedule has no rounds, whatever is stored', () => {
    expect(roundNoteRows({ rounds: [], gamemodeConfig: {} }, { roundNotes: { 'Round 1': 'x' } })).toEqual([]);
  });

  it('lists a stored name that no round has, last and marked, and skips blank and non-text entries', () => {
    const state = generated(31, { qualAdv: '16' });
    const stored = { Gone: 'old', Blank: '  ', stages: { pooling: 'x' } } as unknown as RoundNotes;
    const rows = roundNoteRows(state, { roundNotes: stored });
    expect(rows.at(-1)).toEqual({ name: 'Gone', note: 'old', games: [], orphan: true });
    expect(rows.filter((row) => row.orphan)).toHaveLength(1);
  });

  describe('after a redraw', () => {
    const fewer = generated(31, { qualAdv: '16' });
    const more = generated(43, { qualAdv: '30' });

    it('keeps the note of every name the new schedule still has and starts a new round empty', () => {
      const notes = perRoundNotes(fewer);
      const rows = roundNoteRows(more, { roundNotes: notes });
      expect(rows.map((row) => row.name)).toEqual(roundNoteNames(more));
      for (const name of roundNoteNames(fewer)) {
        expect(rows.find((row) => row.name === name)?.note).toBe(notes[name]);
      }
      expect(rows.find((row) => row.name === 'Round 5')?.note).toBe('');
      expect(rows.some((row) => row.orphan)).toBe(false);
    });

    it('lists the notes of rounds that are gone as orphans', () => {
      const notes = perRoundNotes(more);
      const rows = roundNoteRows(fewer, { roundNotes: notes });
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

/** Head-to-head at 37: qualification rounds of 2 games, the Final a Best of `finalBestOf` (3 games for a Best of 3), the Semis one game. */
const twoGameQual = (finalBestOf = 3): TournamentState =>
  generated(37, { ...HEAD_TO_HEAD, qualAdv: '30', poolingGames: '2', finalsBestOf: String(finalBestOf) });

const withInfo = (
  state: TournamentState,
  extra: Pick<TournamentInfo, 'roundNotes' | 'gameNotes' | 'notePictures'>,
): TournamentState => ({ ...state, info: { ...createDefaultInfo(), ...extra } });

const indexOf = (state: TournamentState, name: string) => roundNoteNames(state).indexOf(name);

describe('noteGameCount', () => {
  it('gives a qualification round of 2 games g1-g2, a Best of 3 Final g1-g3, and a one-game round none (1v1 37)', () => {
    const state = twoGameQual(3);
    const counts = Object.fromEntries(
      roundNoteNames(state).map((name, index) => [name, noteGameCount(state, index)]),
    );
    expect(counts).toEqual({
      'Round 1': 2,
      'Round 2': 2,
      'Round 3': 2,
      'Round 4': 0,
      'Round 5': 0,
      'Round 6': 0,
      Semis: 0,
      Final: 3,
    });
  });

  it('is 0 for a one-game Final, which is its own game, and gives it no game rows', () => {
    const state = generated(37, { qualAdv: '30', finalsGames: '1' });
    const finalIndex = roundNoteNames(state).indexOf('Final');
    expect(noteGameCount(state, finalIndex)).toBe(0);
    expect(roundNoteRows(state, undefined)[finalIndex].games).toEqual([]);
  });

  it('is 0 for a round that does not exist', () => {
    expect(noteGameCount(twoGameQual(), 99)).toBe(0);
  });
});

describe('game boxes follow the most games a room can play', () => {
  /** FFA at 37: the Final is a Best of `bestOf` in a room of 8. */
  const ffaFinal = (bestOf: number) => generated(37, { qualAdv: '30', finalsBestOf: String(bestOf) });
  const finalOf = (state: TournamentState) => roundNoteNames(state).indexOf('Final');

  it.each([3, 5])('FFA, a Best of %i in a room of 8: one box per possible game, at most 9', (bestOf) => {
    const state = ffaFinal(bestOf);
    const most = bestOfGameCount(bestOf, 8);
    expect(state.rounds[finalOf(state)].numGames).toBe(most);
    expect(noteGameCount(state, finalOf(state))).toBe(Math.min(most, MAX_GAME_BOXES));
    expect(noteGameCount(state, finalOf(state))).toBe(9);
  });

  it('a Best of 3 in a room of 7 has 8 boxes, none "and after"', () => {
    const most = bestOfGameCount(3, 7);
    const round = buildRound({ roundNum: 1, rooms: [7], players: 7, bestOf: 3, numGames: most });
    const state = { ...generated(37), rounds: [round] };
    expect(noteGameCount(state, 0)).toBe(8);
    const labels = roundNoteRows(state, undefined)[0].games.map((game) => game.label);
    expect(labels).toEqual(Array.from({ length: 8 }, (_, index) => `Game ${index + 1}`));
  });

  it('a Best of 3 in a room of 8 has 9 boxes and the 9th is plain "Game 9" (9 games at most)', () => {
    const state = ffaFinal(3);
    const games = roundNoteRows(state, undefined)[finalOf(state)].games;
    expect(games).toHaveLength(9);
    expect(games[8].label).toBe('Game 9');
  });

  it('a Best of 5 in a room of 8 (up to 17 games) names the 9th box "Game 9 and after"', () => {
    const state = ffaFinal(5);
    const games = roundNoteRows(state, undefined)[finalOf(state)].games;
    expect(games).toHaveLength(9);
    expect(games.map((game) => game.label).slice(7)).toEqual(['Game 8', 'Game 9 and after']);
    expect(gameNoteRowLabel(games[8])).toBe('Game 9 and after');
  });

  it('the Bracket band shows the 9th box as G9+ ("Game 9 and after"), a plain G9 when 9 is the most', () => {
    const info = { gameNotes: { Final: { g9: 'Powers: Zap' } } };
    const best5 = ffaFinal(5);
    expect(roundSettingsOf(withInfo(best5, info), finalOf(best5))?.games).toEqual([
      { label: 'G9+', name: 'Game 9 and after', note: 'Powers: Zap' },
    ]);
    const best3 = ffaFinal(3);
    expect(roundSettingsOf(withInfo(best3, info), finalOf(best3))?.games).toEqual([
      { label: 'G9', name: 'Game 9', note: 'Powers: Zap' },
    ]);
  });

  it('keeps notes already stored under g1…, whatever the number of boxes', () => {
    const state = ffaFinal(3);
    const info = { gameNotes: { Final: { g1: 'first', g3: 'third', g9: 'ninth' } } };
    const games = roundNoteRows(state, info)[finalOf(state)].games;
    expect(games.filter((game) => game.note).map((game) => [game.key, game.note])).toEqual([
      ['g1', 'first'],
      ['g3', 'third'],
      ['g9', 'ninth'],
    ]);
  });

  it('a summed round of 4 games has 4 boxes', () => {
    const state = generated(37, { ...HEAD_TO_HEAD, qualAdv: '30', poolingGames: '4' });
    expect(noteGameCount(state, indexOf(state, 'Round 1'))).toBe(4);
  });

  it('follows a live change of the round format: Best of 3 to Best of 5 (head-to-head: 3 to 5 boxes)', () => {
    const state = twoGameQual(3);
    const final = indexOf(state, 'Final');
    expect(noteGameCount(state, final)).toBe(3);
    const changed = changeRoundMatchFormat(state, final, { bestOf: 5, numGames: bestOfGameCount(5, 2) });
    if ('error' in changed) throw new Error(changed.error);
    expect(noteGameCount(changed.state, final)).toBe(5);
    expect(roundNoteRows(changed.state, undefined)[final].games).toHaveLength(5);
  });

  it('follows a live change in a room of 8: Best of 3 (9 boxes) to Best of 5 (still 9, now "and after")', () => {
    const state = ffaFinal(3);
    const final = finalOf(state);
    const changed = changeRoundMatchFormat(state, final, { bestOf: 5, numGames: bestOfGameCount(5, 8) });
    if ('error' in changed) throw new Error(changed.error);
    expect(noteGameCount(changed.state, final)).toBe(9);
    expect(roundNoteRows(changed.state, undefined)[final].games[8].label).toBe('Game 9 and after');
  });
});

describe('game rows', () => {
  it('has a row per game of a round that plays several, keyed g1…, and none for a one-game round', () => {
    const rows = roundNoteRows(twoGameQual(3), undefined);
    const keysOf = (name: string) => rows.find((row) => row.name === name)?.games.map((game) => game.key);
    expect(keysOf('Round 1')).toEqual(['g1', 'g2']);
    expect(keysOf('Final')).toEqual(['g1', 'g2', 'g3']);
    expect(keysOf('Semis')).toEqual([]);
    expect(rows.find((row) => row.name === 'Final')?.games.map((game) => game.label)).toEqual([
      'Game 1',
      'Game 2',
      'Game 3',
    ]);
  });

  it('reads the notes and pictures of each game', () => {
    const rows = roundNoteRows(twoGameQual(3), {
      gameNotes: { Final: { g2: '  Powers: Ghost ' } },
      notePictures: { Final: { round: 'picRound01', g3: 'picGame003' } },
    });
    const final = rows.find((row) => row.name === 'Final');
    expect(final?.picture).toBe('picRound01');
    expect(final?.games).toEqual([
      { key: 'g1', label: 'Game 1', note: '' },
      { key: 'g2', label: 'Game 2', note: 'Powers: Ghost' },
      { key: 'g3', label: 'Game 3', note: '', picture: 'picGame003' },
    ]);
  });

  it('keys the games by the unique round name in a Custom bracket of 43 with spaces, dashes and a repeat', () => {
    const rounds = ['Group A', 'Group-B', 'Group A'].map((customLabel, index) => ({
      ...buildRound({ roundNum: index + 1, rooms: [8], players: 43, numGames: index === 2 ? 5 : 1 }),
      customLabel,
      ...(index === 2 && { bestOf: 5 }),
    }));
    const rows = roundNoteRows(
      { rounds, gamemodeConfig: {} },
      { gameNotes: { 'Group A (2)': { g4: 'fourth' }, 'Group A': { g1: 'left over' } } },
    );
    expect(rows.map((row) => row.name)).toEqual(['Group A', 'Group-B', 'Group A (2)']);
    expect(rows[0].games).toEqual([{ key: 'g1', label: 'Game 1', note: 'left over', orphan: true }]);
    expect(rows[2].games.map((game) => game.key)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    expect(rows[2].games[3].note).toBe('fourth');
  });

  it('lists a box beyond the games a Best of 5 now has, with its note or picture, as an orphan game row', () => {
    const best5 = twoGameQual(5);
    const best3 = twoGameQual(3);
    const info = {
      gameNotes: { Final: { g1: 'kept', g4: 'old g4' } },
      notePictures: { Final: { g5: 'picGame005' } },
    };
    expect(roundNoteRows(best5, info).find((row) => row.name === 'Final')?.games).toHaveLength(5);
    const games = roundNoteRows(best3, info).find((row) => row.name === 'Final')?.games ?? [];
    expect(games.map((game) => game.key)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    expect(games.filter((game) => game.orphan).map((game) => game.key)).toEqual(['g4', 'g5']);
    expect(gameNoteRowLabel(games[3])).toBe('Game 4 · not in the schedule');
    expect(gameNoteRowLabel(games[0])).toBe('Game 1');
    expect(roundSettingsOf(withInfo(best3, info), indexOf(best3, 'Final'))).toEqual({
      note: '',
      games: [{ label: 'G1', name: 'Game 1', note: 'kept' }],
    });
  });

  it('lists a name found only in the pictures or the game notes as an orphan round row', () => {
    const rows = roundNoteRows(twoGameQual(), {
      notePictures: { Gone: { round: 'picGone001' } },
      gameNotes: { Elsewhere: { g2: 'x' } },
    });
    expect(rows.filter((row) => row.orphan)).toEqual([
      {
        name: 'Elsewhere',
        note: '',
        games: [{ key: 'g2', label: 'Game 2', note: 'x', orphan: true }],
        orphan: true,
      },
      { name: 'Gone', note: '', picture: 'picGone001', games: [], orphan: true },
    ]);
  });

  it('ignores malformed stored values and invalid game keys', () => {
    const gameNotes = { 'Round 1': 'text', Final: { g10: 'x', g0: 'y', g1: 5, g2: '   ' } };
    const notePictures = { 'Round 1': { round: 7, g1: '' }, Final: ['a'], Gone: 'nope' };
    const rows = roundNoteRows(twoGameQual(), {
      gameNotes: gameNotes as unknown as GameNotes,
      notePictures: notePictures as unknown as NotePictures,
    });
    expect(rows.some((row) => row.orphan)).toBe(false);
    expect(rows.every((row) => row.games.every((game) => !game.note && !game.picture))).toBe(true);
    expect(rows.every((row) => row.picture === undefined)).toBe(true);
  });
});

describe('roundSettingsOf', () => {
  const state = twoGameQual(3);
  const settings = (extra: Parameters<typeof withInfo>[1], name: string) =>
    roundSettingsOf(withInfo(state, extra), indexOf(state, name));

  it('is null for a round with nothing, and for a round that does not exist', () => {
    expect(settings({}, 'Round 1')).toBeNull();
    expect(roundSettingsOf(state, 99)).toBeNull();
    expect(settings({ gameNotes: { 'Round 2': { g1: 'x' } } }, 'Round 1')).toBeNull();
  });

  it('shows the games that have text or a picture, and only those, in order', () => {
    expect(settings({ gameNotes: { Final: { g3: 'last', g2: 'middle' } } }, 'Final')).toEqual({
      note: '',
      games: [
        { label: 'G2', name: 'Game 2', note: 'middle' },
        { label: 'G3', name: 'Game 3', note: 'last' },
      ],
    });
  });

  it('shows a round with only a g2 note as one game line', () => {
    expect(settings({ gameNotes: { 'Round 3': { g2: 'Powers: Zap' } } }, 'Round 3')).toEqual({
      note: '',
      games: [{ label: 'G2', name: 'Game 2', note: 'Powers: Zap' }],
    });
  });

  it("shows a picture without text, the round's own and a game's", () => {
    expect(settings({ notePictures: { Final: { round: 'picRound01', g1: 'picGame001' } } }, 'Final')).toEqual(
      {
        note: '',
        picture: 'picRound01',
        games: [{ label: 'G1', name: 'Game 1', note: '', picture: 'picGame001' }],
      },
    );
  });

  it("puts the round's note first, trimmed", () => {
    expect(settings({ roundNotes: { Final: ' Target 120 ' } }, 'Final')).toEqual({
      note: 'Target 120',
      games: [],
    });
  });

  it('shows nothing for a one-game round that holds g1 text left over from a 2-game format', () => {
    expect(settings({ gameNotes: { Semis: { g1: 'left over' } } }, 'Semis')).toBeNull();
    const rows = roundNoteRows(withInfo(state, { gameNotes: { Semis: { g1: 'left over' } } }), {
      gameNotes: { Semis: { g1: 'left over' } },
    });
    expect(rows.find((row) => row.name === 'Semis')?.games).toEqual([
      { key: 'g1', label: 'Game 1', note: 'left over', orphan: true },
    ]);
  });
});

describe('roundSettingsByRound', () => {
  it('is index-aligned with the rounds and equals roundSettingsOf for each', () => {
    const state = withInfo(twoGameQual(3), {
      roundNotes: { 'Round 2': 'Powers: Zap' },
      gameNotes: { Final: { g3: 'Target 120' } },
      notePictures: { Semis: { round: 'picRound01' } },
    });
    const all = roundSettingsByRound(state);
    expect(all).toHaveLength(state.rounds.length);
    expect(all.map((settings, index) => (settings === null ? null : roundNoteNames(state)[index]))).toEqual([
      null,
      'Round 2',
      null,
      null,
      null,
      null,
      'Semis',
      'Final',
    ]);
    all.forEach((settings, index) => expect(settings).toEqual(roundSettingsOf(state, index)));
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

describe('infoWithGameNote', () => {
  const info = { ...createDefaultInfo(), rulesText: 'No pause', screenshots: ['image00000001'] };

  it('sets a game note and keeps the rest of the info, the other games and the other rounds', () => {
    const one = infoWithGameNote(info, 'Round 1', 'g2', ' Powers: Zap ');
    expect(one).toEqual({ ...info, gameNotes: { 'Round 1': { g2: 'Powers: Zap' } } });
    const more = infoWithGameNote(infoWithGameNote(one, 'Round 1', 'g1', 'a'), 'Final', 'g3', 'b');
    expect(more.gameNotes).toEqual({ 'Round 1': { g2: 'Powers: Zap', g1: 'a' }, Final: { g3: 'b' } });
  });

  it('clears the game on blank text, the round with its last game and gameNotes with its last round', () => {
    const two = infoWithGameNote(infoWithGameNote(info, 'Round 1', 'g1', 'a'), 'Round 1', 'g2', 'b');
    expect(infoWithGameNote(two, 'Round 1', 'g1', '  ').gameNotes).toEqual({ 'Round 1': { g2: 'b' } });
    const rounds = infoWithGameNote(infoWithGameNote(info, 'Round 1', 'g1', 'a'), 'Final', 'g1', 'b');
    expect(infoWithGameNote(rounds, 'Round 1', 'g1', '').gameNotes).toEqual({ Final: { g1: 'b' } });
    const cleared = infoWithGameNote(infoWithGameNote(info, 'Final', 'g1', 'b'), 'Final', 'g1', '');
    expect(cleared).toEqual(info);
    expect('gameNotes' in cleared).toBe(false);
  });

  it('leaves the round notes and pictures alone', () => {
    const base = { ...info, roundNotes: { Final: 'x' }, notePictures: { Final: { round: 'picRound01' } } };
    const next = infoWithGameNote(base, 'Final', 'g1', 'a');
    expect(next.roundNotes).toEqual({ Final: 'x' });
    expect(next.notePictures).toEqual({ Final: { round: 'picRound01' } });
  });

  it('drops entries that are not text on a save, and does not change the info it was given', () => {
    const old = {
      ...info,
      gameNotes: { 'Round 1': { g1: 5, g2: 'kept' }, Final: 'nope' } as unknown as GameNotes,
    };
    const before = structuredClone(old);
    expect(infoWithGameNote(old, 'Round 2', 'g1', 'a').gameNotes).toEqual({
      'Round 1': { g2: 'kept' },
      'Round 2': { g1: 'a' },
    });
    expect(old).toEqual(before);
  });
});

describe('roundNoteRowLabel', () => {
  it("is the round's name, and marks a name that no round of the schedule has now", () => {
    expect(roundNoteRowLabel({ name: 'Round 4', note: '', games: [] })).toBe('Round 4');
    expect(roundNoteRowLabel({ name: 'Round 4', note: 'x', games: [], orphan: true })).toBe(
      'Round 4 · not in the schedule',
    );
  });
});

describe('infoWithRenamedRounds', () => {
  const infoOf = (parts: Partial<TournamentInfo>): TournamentInfo => ({ ...createDefaultInfo(), ...parts });
  const SHIFT = new Map([
    ['Round 4', 'Round 5'],
    ['Round 5', 'Round 6'],
  ]);

  it('moves the round notes and the game notes with their rounds, all at once (no name overwrites another)', () => {
    const moved = infoWithRenamedRounds(
      infoOf({
        roundNotes: { 'Round 4': 'four', 'Round 5': 'five', 'Round 4 - Upper': 'typed', Final: 'final' },
        gameNotes: { 'Round 4': { g1: 'four g1' }, 'Round 5': { g2: 'five g2' } },
      }),
      SHIFT,
    );
    expect(moved.roundNotes).toEqual({
      'Round 5': 'four',
      'Round 6': 'five',
      'Round 4 - Upper': 'typed',
      Final: 'final',
    });
    expect(moved.gameNotes).toEqual({ 'Round 5': { g1: 'four g1' }, 'Round 6': { g2: 'five g2' } });
  });

  it('leaves the pictures and every other field as they are', () => {
    const pictures: NotePictures = { 'Round 4': { round: 'image-1' } };
    const info = infoOf({ roundNotes: { 'Round 4': 'four' }, notePictures: pictures });
    const moved = infoWithRenamedRounds(info, SHIFT);
    expect(moved.notePictures).toBe(pictures);
    expect(moved.rulesText).toBe(info.rulesText);
  });

  it('is the same info when nothing is renamed, and when there are no notes', () => {
    const info = infoOf({ roundNotes: { 'Round 4': 'four' } });
    expect(infoWithRenamedRounds(info, new Map())).toBe(info);
    const bare = infoOf({});
    expect(infoWithRenamedRounds(bare, SHIFT)).toEqual(bare);
    expect('roundNotes' in infoWithRenamedRounds(bare, SHIFT)).toBe(false);
  });

  it('keeps the note a name outside the renames already has, and takes the moved one only when that is empty', () => {
    // "Round 5" is moved away here, so the target is free; a name that stays and is taken keeps its own note.
    const rename = new Map([['Round 4', 'Round 9']]);
    const kept = infoWithRenamedRounds(
      infoOf({ roundNotes: { 'Round 4': 'moved', 'Round 9': 'already here' } }),
      rename,
    );
    expect(kept.roundNotes).toEqual({ 'Round 9': 'already here' });
    const empty = infoWithRenamedRounds(
      infoOf({ roundNotes: { 'Round 4': 'moved', 'Round 9': '  ' } }),
      rename,
    );
    expect(empty.roundNotes).toEqual({ 'Round 9': 'moved' });
  });

  it('merges game notes box by box: a box the target already holds keeps its text, an empty one takes the moved text', () => {
    const merged = infoWithRenamedRounds(
      infoOf({ gameNotes: { 'Round 4': { g1: 'moved 1', g2: 'moved 2' }, 'Round 9': { g1: 'kept 1' } } }),
      new Map([['Round 4', 'Round 9']]),
    );
    expect(merged.gameNotes).toEqual({ 'Round 9': { g1: 'kept 1', g2: 'moved 2' } });
  });
});
