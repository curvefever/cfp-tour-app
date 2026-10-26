import { describe, expect, it } from 'vitest';
import { fixtureTournaments, loadedState } from '../../../e2e/screens/fixtures';
import { getAllColumnTies } from '../../domain/tournament/advancement';
import { withEarlierPointsRule } from '../../domain/tournament/__tests__/play-through';
import { shareTiedPoints } from '../../domain/tournament/mutations';
import {
  describeStandings,
  tableRoundIndexes,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { compactRoundPoints, standingsDetailLines } from './standings-compact';
import { sharesWholePercent } from './standings-text';

type Entry = StandingsDisplayTable['entries'][number];

function stateOf(id: string): TournamentState {
  const fixture = fixtureTournaments().find((entry) => entry.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  return withEarlierPointsRule(loadedState(fixture));
}

/** The table of a fixture's standings that `pick` accepts (the first by default), with what a row needs. */
function tableOf(state: TournamentState, pick: (table: StandingsDisplayTable) => boolean = () => true) {
  const table = describeStandings(state)?.tables.find(pick);
  if (!table) throw new Error('no such table');
  const roundIndexes = tableRoundIndexes(state, table);
  const labels = roundIndexes.map((index) => `Round ${state.rounds[index].roundNum}`);
  const shares = sharesWholePercent(
    table.entries.map((entry) => ({ points: entry.totalFP, share: entry.roomShare })),
  );
  const detail = (entry: Entry) =>
    standingsDetailLines(entry, roundIndexes, labels, shares[table.entries.indexOf(entry)]);
  return { table, roundIndexes, labels, shares, detail };
}

const byName = (table: StandingsDisplayTable, name: string): Entry => {
  const entry = table.entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`no ${name}`);
  return entry;
};

describe('FFA 37 after Round 3', () => {
  const { table, roundIndexes, detail } = tableOf(stateOf('ffa37-quarters'));

  it('lists the points of the three counted rounds on one line', () => {
    expect(compactRoundPoints(byName(table, 'Player 26'), roundIndexes)).toBe('8 · 8 · 6');
    expect(compactRoundPoints(byName(table, 'Player 09'), roundIndexes)).toBe('8 · 1 · 8');
  });

  it('unfolds a row into score, place and points per round, then the tie-break', () => {
    expect(detail(byName(table, 'Player 26'))).toEqual([
      'Round 1 · 84 · 1st · 8 pts',
      'Round 2 · 78 · 1st · 8 pts',
      'Round 3 · 66 · 3rd · 6 pts',
      'Tie-break 144%',
    ]);
  });

  it('writes one point as "1 pt"', () => {
    expect(detail(byName(table, 'Player 09'))[1]).toBe('Round 2 · 22 · 8th · 1 pt');
  });

  it('adds the two-decimal tie-break to both units on the same points and whole percent', () => {
    expect(detail(byName(table, 'Player 16')).at(-1)).toBe('Tie-break 110% (109.99%)');
    expect(detail(byName(table, 'Player 08')).at(-1)).toBe('Tie-break 110% (109.86%)');
  });

  it('adds nothing for a unit alone on its whole percent', () => {
    expect(detail(byName(table, 'Player 19')).at(-1)).toBe('Tie-break 134%');
  });
});

describe('a round the unit missed (a late joiner at 37)', () => {
  const { table, roundIndexes, labels } = tableOf(stateOf('ffa37-quarters'));
  const joiner: Entry = {
    ...byName(table, 'Player 19'),
    rounds: byName(table, 'Player 19').rounds?.filter((result) => result.roundIndex !== roundIndexes[1]),
  };

  it('shows "—" for the missed round in both forms', () => {
    expect(compactRoundPoints(joiner, roundIndexes)).toBe('8 · — · 6');
    expect(standingsDetailLines(joiner, roundIndexes, labels, false)).toEqual([
      'Round 1 · 75 · 1st · 8 pts',
      'Round 2 · —',
      'Round 3 · 61 · 3rd · 6 pts',
      'Tie-break 134%',
    ]);
  });
});

describe('a bye (head-to-head 1v1, 13 players, group stage)', () => {
  const state = stateOf('groups-1v1-13');
  const { table, roundIndexes, detail } = tableOf(state, (candidate) =>
    candidate.entries.some((entry) => entry.rounds?.some((result) => result.bye)),
  );
  const bye = byName(table, 'Player 01');

  it('reads "Bye" with its points, and no tie-break without a played round', () => {
    expect(detail(bye)).toEqual([
      'Round 1 · Bye · 2 pts',
      'Round 2 · —',
      'Round 3 · —',
      'Round 4 · —',
      'Round 5 · —',
      'Tie-break —',
    ]);
    expect(compactRoundPoints(bye, roundIndexes)).toBe('2 · — · — · — · —');
  });

  it('reads a played round of the same group as score, place and points', () => {
    expect(detail(byName(table, 'Player 13'))[0]).toBe('Round 1 · 26 · 2nd · 1 pt');
  });
});

describe('a shared place from a shared-points tie', () => {
  const base = stateOf('ffa37-pooling');
  const tied: TournamentState = { ...base, scores: { ...base.scores, 'r2-rm1-p0': 80, 'r2-rm1-p1': 80 } };
  const [key, tie] = Object.entries(getAllColumnTies(tied))[0];
  const shared = shareTiedPoints(
    tied,
    key,
    tie.players.map((player) => player.name),
  );
  const { table, roundIndexes, detail } = tableOf(shared);

  it('puts "=" before the place and shows the shared points, in both forms', () => {
    expect(detail(byName(table, 'Player 26'))[2]).toBe('Round 3 · 80 · =1st · 7.5 pts');
    expect(detail(byName(table, 'Player 08'))[2]).toBe('Round 3 · 80 · =1st · 7.5 pts');
    expect(compactRoundPoints(byName(table, 'Player 08'), roundIndexes)).toBe('8 · 7 · 7.5');
  });
});

describe('2v2v2v2 with 13 teams', () => {
  const state = stateOf('teams2v2-13');
  const { table, roundIndexes, detail } = tableOf(state);

  it('reads a team row like an individual one', () => {
    const leader = table.entries[0];
    expect(compactRoundPoints(leader, roundIndexes)).toBe('3 · 4 · 4');
    expect(detail(leader)).toEqual([
      'Round 1 · 29 · 2nd · 3 pts',
      'Round 2 · 54 · 1st · 4 pts',
      'Round 3 · 38 · 1st · 4 pts',
      'Tie-break 118%',
    ]);
  });
});
