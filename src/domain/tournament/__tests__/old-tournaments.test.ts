import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pinsOf } from './old-tournaments-pins';

/**
 * The finished tournaments the app has run, pinned as the screens show them: the Rankings rows, the winners, the
 * Standings rows with points and tie-break, the exit rule of each round on the Bracket, the Final's order. The stored
 * data (`old-tournaments/{id}.json`, read once through the anonymous REST read, names replaced by P01.. and T01..,
 * free texts emptied) loads through the app's own loader, so a rule changed by a later build shows up here as a
 * different row. These are the only tests that run the rules on data the app did not generate itself: the earlier
 * points rule, the earlier cut, the earlier group rule, column play.
 */

function stored(id: string): unknown {
  return JSON.parse(readFileSync(new URL(`./old-tournaments/${id}.json`, import.meta.url), 'utf8'));
}

describe('18 Oct 2026, 2v2v2v2 Survival Teams', () => {
  // 18 Oct 2026, production. 25 teams (24 confirmed) of 2 in rooms of 3-4 (format team-2v2v2v2, scoring "survival teams"),
  // a qualification table of 4 rounds (the first one not counting), then a Custom bracket (waterfall) of 7 rounds with
  // a Qual line, played by columns. Switches stored: none (the earlier points rule, the earlier cut, no group stage,
  // no absentees, no dependency play).
  const pins = pinsOf(stored('1792339397443'));

  it('Rankings: the place and unit of every row', () => {
    expect(pins.rankings).toEqual({
      finalComplete: true,
      stillActive: [],
      finalists: [
        [1, 'T12', 27],
        [2, 'T01', 25],
        [3, 'T03', 20],
        [4, 'T13', 6],
      ],
      eliminated: [
        [5, 3, 10, 'T30'],
        [6, 4, 10, 'T08'],
        [7, 3, 9, 'T11'],
        [8, 4, 9, 'T32'],
        [9, 3, 8, 'T09'],
        [10, 3, 8, 'T35'],
        [11, 4, 8, 'T37'],
        [12, 4, 8, 'T31'],
        [13, 3, 6, 'T38'],
        [14, 3, 6, 'T34'],
        [15, 4, 6, 'T39'],
        [16, 4, 6, 'T06'],
        [17, 2, 4, 'T07'],
        [18, 3, 4, 'T04'],
        [19, 2, 4, 'T05'],
        [20, 3, 4, 'T10'],
        [21, 4, 4, 'T40'],
        [22, 4, 4, 'T14'],
        [23, 3, 4, 'T36'],
        [24, 4, 4, 'T33'],
        [25, 4, 4, 'T02'],
      ],
      withdrawn: [],
      absentFromStart: [],
    });
  });

  it('the winners', () => {
    expect(pins.winners).toEqual([['T12', ['P03', 'P70']]]);
  });

  it('Standings: the rows in order, with points and tie-break', () => {
    expect(pins.standings).toEqual({
      phase: 'final',
      kind: 'qualification',
      roundsDone: 3,
      roundsTotal: 3,
      tables: [
        {
          label: 'Qualification Table',
          cut: 16,
          entries: [
            [1, 'team_1792345651683_3', 12, 1.5139, null, null],
            [2, 'team_1792345651683_18', 12, 1.4259, null, null],
            [3, 'team_1792345651683_5', 11, 1.5864, null, null],
            [4, 'team_1792345651683_1', 11, 1.5066, null, null],
            [5, 'team_1792345651683_19', 11, 1.4206, null, null],
            [6, 'team_1792345651683_2', 11, 1.1189, null, null],
            [7, 'team_1792345651683_15', 10, 1.4215, null, null],
            [8, 'team_1792345651683_7', 10, 1.2799, null, null],
            [9, 'team_1792345651683_14', 10, 1.2798, null, null],
            [10, 'team_1792345651683_20', 10, 1.1338, null, null],
            [11, 'team_1792345651683_10', 9, 1.3006, null, null],
            [12, 'team_1792345651684_21', 9, 1.0048, null, null],
            [13, 'team_1792345651683_12', 8, 0.9991, null, null],
            [14, 'team_1792347555271_0', 8, 0.954, null, null],
            [15, 'team_1792345651683_17', 8, 0.9012, null, null],
            [16, 'team_1792345651684_23', 7.5, 0.8148, null, null],
            [17, 'team_1792345651683_11', 7, 0.9182, null, null],
            [18, 'team_1792345651683_9', 6, 0.8951, null, null],
            [19, 'team_1792345651683_0', 6, 0.6734, null, null],
            [20, 'team_1792345651683_13', 6, 0.5833, null, null],
            [21, 'team_1792345651684_22', 4.5, 0.6152, null, null],
            [22, 'team_1792345651683_4', 4, 0.4398, null, null],
            [23, 'team_1792345651683_8', 4, 0.3986, null, null],
            [24, 'team_1792345651683_16', 3, 0.4599, null, null],
            [25, 'team_1792345651683_6', 3, 0.3545, null, null],
          ],
        },
      ],
    });
  });

  it("the Bracket's exit rule of every round", () => {
    expect(pins.exits).toEqual([
      {
        kind: 'standings',
      },
      {
        kind: 'standings',
      },
      {
        kind: 'standings',
      },
      {
        kind: 'standings-cutoff',
        advancing: 16,
        perGroup: false,
        destination: 4,
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 2, 6],
            ['advance', 3, 4, 7],
          ],
          [
            ['advance', 1, 2, 6],
            ['advance', 3, 4, 7],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 2, 7],
            ['eliminate', 3, 4, null],
          ],
          [
            ['advance', 1, 2, 7],
            ['eliminate', 3, 4, null],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 2, 10],
            ['advance', 3, 4, 9],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 2, 8],
            ['eliminate', 3, 4, null],
          ],
          [
            ['advance', 1, 2, 8],
            ['eliminate', 3, 4, null],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 2, 9],
            ['eliminate', 3, 4, null],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 2, 10],
            ['eliminate', 3, 4, null],
          ],
        ],
      },
      {
        kind: 'none',
      },
    ]);
  });

  it("the Final's order", () => {
    expect(pins.final).toEqual({
      complete: true,
      order: [
        'team_1792345651683_19',
        'team_1792345651683_1',
        'team_1792345651683_3',
        'team_1792345651683_5',
      ],
    });
  });
});

describe('20 Oct 2026, FFA test run', () => {
  // 20 Oct 2026, production, a test run ("Platform Test Tournament", reconstituted from a recording on the test platform).
  // 16 individual players (format ffa-individual), a qualification table of 2 rounds, then a Custom bracket R1, R2 and a
  // Final of 2 games, with a Qual line, played by columns. Switches stored: none (the earlier points rule, the earlier
  // cut, no absentees, no dependency play).
  const pins = pinsOf(stored('1792489989400'));

  it('Rankings: the place and unit of every row', () => {
    expect(pins.rankings).toEqual({
      finalComplete: true,
      stillActive: [],
      finalists: [
        [1, 'P15', 760],
        [2, 'P10', 750],
        [3, 'P14', 725],
        [4, 'P05', 697],
        [5, 'P02', 575],
        [6, 'P16', 526],
        [7, 'P08', 501],
        [8, 'P06', 499],
      ],
      eliminated: [
        [9, 5, 4, 'P07'],
        [10, 5, 4, 'P13'],
        [11, 6, 4, 'P04'],
        [12, 6, 4, 'P11'],
        [13, 7, 3, 'P12'],
        [14, 7, 3, 'P09'],
        [15, 8, 2, 'P03'],
        [16, 7, 2, 'P01'],
      ],
      withdrawn: [],
      absentFromStart: [],
    });
  });

  it('the winners', () => {
    expect(pins.winners).toEqual([['P15', null]]);
  });

  it('Standings: the rows in order, with points and tie-break', () => {
    expect(pins.standings).toEqual({
      phase: 'final',
      kind: 'qualification',
      roundsDone: 2,
      roundsTotal: 2,
      tables: [
        {
          label: 'Qualification Table',
          cut: 14,
          entries: [
            [1, 'P10', 16, 1.8839, null, null],
            [2, 'P15', 14, 1.7614, null, null],
            [3, 'P14', 14, 1.5287, null, null],
            [4, 'P06', 13, 1.6011, null, null],
            [5, 'P08', 13, 1.5204, null, null],
            [6, 'P02', 12, 1.3291, null, null],
            [7, 'P05', 10, 1.3543, null, null],
            [8, 'P13', 9, 1.0646, null, null],
            [9, 'P04', 9, 1.0201, null, null],
            [10, 'P16', 8, 1.1167, null, null],
            [11, 'P07', 8, 1.1166, null, null],
            [12, 'P11', 6, 0.6697, null, null],
            [13, 'P12', 3, 0.0088, null, null],
            [14, 'P09', 3, 0.0087, null, null],
            [15, 'P03', 3, 0.0082, null, null],
            [16, 'P01', 3, 0.0075, null, null],
          ],
        },
      ],
    });
  });

  it("the Bracket's exit rule of every round", () => {
    expect(pins.exits).toEqual([
      {
        kind: 'standings',
      },
      {
        kind: 'standings-cutoff',
        advancing: 14,
        perGroup: false,
        destination: 2,
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 6, 3],
            ['eliminate', 7, 7, null],
          ],
          [
            ['advance', 1, 6, 3],
            ['eliminate', 7, 7, null],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 4, 4],
            ['eliminate', 5, 6, null],
          ],
          [
            ['advance', 1, 4, 4],
            ['eliminate', 5, 6, null],
          ],
        ],
      },
      {
        kind: 'none',
      },
    ]);
  });

  it("the Final's order", () => {
    expect(pins.final).toEqual({
      complete: true,
      order: ['P15', 'P10', 'P14', 'P05', 'P02', 'P16', 'P08', 'P06'],
    });
  });
});

describe('1 Nov 2026, 4v4 Classic Teams', () => {
  // 1 Nov 2026, production. 11 teams of 4 (format team-4v4, scoring "survival teams"), a Group Stage of 3 rounds in
  // groups of 4 with match results and a fair-cut group exit, then a Custom bracket of 9 rounds with a Groups line, a
  // Best of 3 Semi-Final and ranking rounds, played by columns. Switches stored: pointsVersion 2, cutVersion 2,
  // groupAverageVersion 2, absenceVersion 1 (no dependencyPlayVersion).
  const pins = pinsOf(stored('1793555835749'));

  it('Rankings: the place and unit of every row', () => {
    expect(pins.rankings).toEqual({
      finalComplete: true,
      stillActive: [],
      finalists: [
        [1, 'T05', 2],
        [2, 'T07', 0],
      ],
      eliminated: [
        [3, 2, 11, 'T08'],
        [4, 2, 10, 'T11'],
        [5, 1, 9, 'T01'],
        [6, 2, 9, 'T03'],
        [7, 1, 6, 'T06'],
        [8, 2, 6, 'T02'],
        [9, 1, 3, 'T04'],
        [10, 2, 3, 'T09'],
        [11, 2, 3, 'T10'],
      ],
      withdrawn: [],
      absentFromStart: [],
    });
  });

  it('the winners', () => {
    expect(pins.winners).toEqual([['T05', ['P09', 'P16', 'P03', 'P36']]]);
  });

  it('Standings: the rows in order, with points and tie-break', () => {
    expect(pins.standings).toEqual({
      phase: 'final',
      kind: 'groups',
      roundsDone: 3,
      roundsTotal: 3,
      tables: [
        {
          label: 'Group A',
          cut: 3,
          entries: [
            [1, 'team_1793558922805_10', 9, 1.2266, 3, null],
            [2, 'team_1793558922805_6', 6, 1.1098, 2, null],
            [3, 'team_1793558922805_5', 3, 0.8802, 1, null],
            [4, 'team_1793558922805_0', 0, 0.7834, 0, null],
          ],
        },
        {
          label: 'Group B',
          cut: 3,
          entries: [
            [1, 'team_1793558922805_7', 9, 1.3171, 3, null],
            [2, 'team_1793558922805_9', 6, 0.9985, 2, null],
            [3, 'team_1793558922805_4', 2, 0.8287, 0.6667, null],
            [4, 'team_1793558922805_1', 1, 0.8557, 0.3333, null],
          ],
        },
        {
          label: 'Group C',
          cut: 2,
          entries: [
            [1, 'team_1793558922805_3', 6, 1.3681, 3, null],
            [2, 'team_1793558922805_2', 3, 1.0121, 1.5, null],
            [3, 'team_1793558922805_8', 0, 0.6198, 0, null],
          ],
        },
      ],
    });
  });

  it("the Bracket's exit rule of every round", () => {
    expect(pins.exits).toEqual([
      {
        kind: 'standings',
      },
      {
        kind: 'standings',
      },
      {
        kind: 'standings-cutoff',
        advancing: 8,
        perGroup: true,
        destination: 3,
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 1, 6],
            ['advance', 2, 2, 7],
          ],
          [
            ['advance', 1, 1, 6],
            ['advance', 2, 2, 7],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 1, 7],
            ['advance', 2, 2, 5],
          ],
          [
            ['advance', 1, 1, 7],
            ['advance', 2, 2, 5],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [[['eliminate', 1, 2, null]]],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 1, 11],
            ['advance', 2, 2, 10],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 1, 9],
            ['advance', 2, 2, 8],
          ],
          [
            ['advance', 1, 1, 9],
            ['advance', 2, 2, 8],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [[['eliminate', 1, 2, null]]],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 1, 10],
            ['eliminate', 2, 2, null],
          ],
        ],
      },
      {
        kind: 'per-room',
        rooms: [
          [
            ['advance', 1, 1, 11],
            ['eliminate', 2, 2, null],
          ],
        ],
      },
      {
        kind: 'none',
      },
    ]);
  });

  it("the Final's order", () => {
    expect(pins.final).toEqual({
      complete: true,
      order: ['team_1793558922805_10', 'team_1793558922805_7'],
    });
  });
});
