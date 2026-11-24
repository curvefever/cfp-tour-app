import { describe, expect, it } from 'vitest';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { declaredSchedule } from '../../domain/tournament/declared-schedule';
import { removeRosterUnit } from '../../domain/tournament/mutations';
import { roundExitRule } from '../../domain/tournament/room-exits';
import type { TournamentState } from '../../domain/tournament/types';
import { built } from '../../domain/tournament/__tests__/layered-test-support';
import { buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import { roomExitLines } from '../tournament/components/exit-lines';
import { schedulePictureModel } from './schedule-picture-model';
import { HEADER, MOCKUP_GRAPH, blockLines, cardNamed, modelOf } from './schedule-picture-test-support';

/** The places a block's first line starts with: "1st–4th → X" is [1, 4], "5th–last out" is [5, 'last'], "3rd: the best…" is [3, 3]. */
function placesOf(line: string): [number, number | 'last'] {
  const match = /^(?:Places )?(\d+)(?:st|nd|rd|th)(?:–(?:(\d+)(?:st|nd|rd|th)|(last)))?/.exec(line);
  if (!match) throw new Error(`no places in "${line}"`);
  const from = Number(match[1]);
  if (match[3]) return [from, 'last'];
  return [from, match[2] ? Number(match[2]) : from];
}

const bracketRounds = (state: TournamentState) =>
  state.rounds.flatMap((round, index) => (round.isQual ? [] : [index]));

describe.each([31, 37, 43, 53])('the layered bracket at %i players', (count) => {
  const state = built(count);
  const model = modelOf(state);

  it('draws every bracket round in exactly one card', () => {
    const drawn = model.cards.flatMap((card) => card.rounds).sort((first, second) => first - second);
    expect(drawn).toEqual(bracketRounds(state));
  });

  it('covers places 1 to the room size in every room group, with no gap and no overlap', () => {
    for (const card of model.cards) {
      const sizes = card.rounds.flatMap((index) => state.rounds[index].rooms);
      for (const group of card.groups) {
        let next = 1;
        for (const block of group.blocks) {
          const [from, to] = placesOf(block.lines[0]);
          expect(from).toBe(next);
          next = to === 'last' ? Math.max(...sizes) + 1 : to + 1;
        }
        expect(sizes).toContain(next - 1);
      }
    }
  });

  it("gives each block the tone the Bracket's exit lines give the same band", () => {
    const declared = declaredSchedule(state);
    const labels = bracketRoundLabels(declared);
    for (const card of model.cards) {
      const drawn = card.groups.map((group) => group.blocks.map((block) => block.tones[0]));
      for (const index of card.rounds) {
        const rule = roundExitRule(declared, index);
        if (rule.kind !== 'per-room') continue;
        for (const bands of rule.rooms) {
          expect(drawn).toContainEqual(roomExitLines(bands, labels).map((line) => line.tone));
        }
      }
    }
  });
});

describe('the colours and words of the layered bracket', () => {
  it('31 players: a round takes the colour of the earliest column that sends it players', () => {
    const model = modelOf(built(31));
    expect(cardNamed(model, 'Round 4 - Lower').tone).toBe('yellow');
    expect(cardNamed(model, 'Round 5 - Lower').tone).toBe('purple');
    expect(cardNamed(model, 'Semi-Final B').tone).toBe('yellow');
    expect(cardNamed(model, 'Semi-Final A').tone).toBe('green');
    expect(cardNamed(model, 'Final').tone).toBe('green');
  });

  it('31 players: the Final plays for places, the lower round says its rooms and games', () => {
    const model = modelOf(built(31));
    expect(cardNamed(model, 'Final').groups[0].blocks[0].lines).toEqual(['Places 1st–8th']);
    expect(cardNamed(model, 'Round 4 - Lower')).toMatchObject({ tag: '×2', sub: '8p and 7p · 1 game' });
    expect(blockLines(cardNamed(model, 'Round 4 - Lower'))).toEqual([
      '1st–4th → Round 5 - Lower',
      '5th–last out',
    ]);
  });

  it('43 players: the two Round 4 rounds are two rooms of 8 each', () => {
    const model = modelOf(built(43));
    for (const name of ['Round 4 - Upper', 'Round 4 - Lower']) {
      expect(cardNamed(model, name)).toMatchObject({ tag: '×2', sub: '8p each · 1 game' });
    }
  });
});

describe('a Custom bracket', () => {
  const model = modelOf(buildQualWaterfall(55, MOCKUP_GRAPH, { qualAdv: '37' }, { columns: true }));

  it('rooms of 7 and 6 that exit alike are one group, written to the last place', () => {
    const card = cardNamed(model, 'Round 5 Middle');
    expect(card).toMatchObject({ tag: '×2', sub: '7p and 6p · 1 game' });
    expect(card.groups).toHaveLength(1);
    expect(blockLines(card)).toEqual(['1st–3rd → Round 6 Middle', '4th–last → Round 6 Lower']);
  });

  it('a best of a place is a two-line block with the tone of each route', () => {
    expect(cardNamed(model, 'Round 7 Upper').groups[0].blocks[1]).toEqual({
      tones: ['green', 'yellow'],
      lines: ['4th: the best one → Semi B', 'the other → Round 8'],
    });
  });

  it('colours the cards as the mockup does', () => {
    const tones = Object.fromEntries(model.cards.map((card) => [card.name, card.tone]));
    expect(tones).toMatchObject({
      'Round 5 Upper': 'green',
      'Round 5 Middle': 'yellow',
      'Round 5 Lower': 'purple',
      'Round 7 Upper': 'yellow',
      'Round 7 Lower': 'purple',
      Final: 'green',
    });
  });

  it('describes the pooling block from the Qual line', () => {
    expect(model.pooling?.afterLast.map((block) => [block.tones[0], block.lines[0]])).toEqual([
      ['green', '1st–16th → Round 5 Upper'],
      ['yellow', '17th–29th → Round 5 Middle'],
      ['purple', '30th–37th → Round 5 Lower'],
      ['red', '38th–last out'],
    ]);
  });
});

describe('two rounds of one column with the same exits', () => {
  const graph = `ROUNDS:
Round 6 B = 8
Round 6 C = 8
Final = 8 FINAL

ROUTES:
Qual: 1-8->Round 6 B, 9-16->Round 6 C
Round 6 B: 1-4->Final, 5-8->eliminated
Round 6 C: 1-4->Final, 5-8->eliminated
`;

  it('are one card named after the words they share, holding the rooms of both', () => {
    const model = modelOf(buildQualWaterfall(16, graph, { qualAdv: '16' }, { columns: true }));
    expect(model.cards.map((card) => card.name)).toEqual(['Round 6 · B, C', 'Final']);
    expect(cardNamed(model, 'Round 6 · B, C')).toMatchObject({ tag: '×2', sub: '8p each · 1 game', row: 0 });
    expect(cardNamed(model, 'Round 6 · B, C').rounds).toHaveLength(2);
  });
});

describe('other formats', () => {
  it('single elimination after a qualification table at 37: the lucky place is a two-line block', () => {
    const model = modelOf(generated(37, { scheduleLogic: 'single-elimination', qualAdv: '20' }));
    const blocks = model.cards.flatMap((card) => card.groups.flatMap((group) => group.blocks));
    const lucky = blocks.find((block) => block.lines.length === 2);
    expect(lucky?.tones).toEqual(['green', 'red']);
    expect(lucky?.lines[0]).toMatch(/^\d+(st|nd|rd|th): the best (one|\d+(–\d+)?) → /);
    expect(lucky?.lines[1]).toMatch(/^the others? out$/);
  });

  it('double elimination 1v1 at 16: a drop to the losers bracket is purple, each round in a column of its own', () => {
    const model = modelOf(
      generated(16, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
      }),
    );
    const winners = cardNamed(model, 'WB Round 3');
    expect(winners).toMatchObject({ tag: null, sub: '8 matches · 1 game' });
    expect(winners.groups[0].blocks).toEqual([
      { tones: ['green'], lines: ['1st → WB Round 4'] },
      { tones: ['purple'], lines: ['2nd → LB Round 3'] },
    ]);
    expect(cardNamed(model, 'LB Round 3').tone).toBe('purple');
    expect(new Set(model.cards.map((card) => card.column)).size).toBe(model.cards.length);
  });

  it('Kings Valley at 31: rooms that exit differently are labelled groups, the sub line holds the games only', () => {
    const model = modelOf(generated(31, { scheduleLogic: 'kings-valley', poolingPhase: 'none' }));
    const card = cardNamed(model, 'Round 3');
    expect(card.sub).toBe('1 game');
    expect(card.groups.map((group) => group.label)).toEqual([
      'Room A · 8p',
      'Room B · 8p',
      'Room C · 8p',
      'Room D · 7p',
    ]);
    expect(card.groups[1].blocks.map((block) => [block.tones[0], block.lines[0]])).toEqual([
      ['green', '1st–2nd → Room A'],
      ['yellow', '3rd–4th stay'],
      ['orange', '5th–8th → Room C'],
    ]);
  });

  it('teams: sizes are in teams', () => {
    const model = modelOf(
      generated(13, {
        gameFormat: 'team-2v2v2v2',
        poolingPhase: 'qual-table',
        qualAdv: '8',
        scheduleLogic: 'single-elimination',
      }),
    );
    expect(model.header.count).toBe('13 teams');
    expect(cardNamed(model, 'Semis')).toMatchObject({ tag: '×2', sub: '4 teams each · 1 game' });
    expect(model.pooling?.lines[1]).toBe('4 rooms · 4 and 3 teams');
  });
});

describe('what the picture reads', () => {
  it('has no model while the schedule has no rounds', () => {
    expect(schedulePictureModel({ ...built(31), rounds: [] }, HEADER)).toBeNull();
  });

  it('carries the header it is given and the registered count', () => {
    expect(modelOf(built(31)).header).toEqual({
      title: HEADER.title,
      formatLine: HEADER.formatLine,
      count: '31 players',
    });
  });

  it('a removal in a drawn round leaves the cards and the pooling block unchanged', () => {
    const state = built(31);
    const before = modelOf(state);
    const after = modelOf(removeRosterUnit(state, state.assignments[0][0].name));
    expect(after.cards).toEqual(before.cards);
    expect(after.pooling).toEqual(before.pooling);
    expect(after.header.count).toBe('30 players');
  });
});
