import type { StandingsDisplayTable } from '../../domain/tournament/standings-display';
import type { TournamentRound } from '../../domain/tournament/types';
import {
  formatTieBreak,
  formatTieBreakPrecise,
  missedRoundOf,
  pointsCell,
  roundCells,
} from './standings-text';

type Entry = StandingsDisplayTable['entries'][number];

/** The rounds of the tournament, for the Best of N ones: their score cell reads the wins. */
type Rounds = ReadonlyArray<Pick<TournamentRound, 'bestOf'>>;

function cellsOf(entry: Entry, roundIndex: number, rounds: Rounds) {
  return roundCells(
    entry.rounds?.find((result) => result.roundIndex === roundIndex),
    entry.absentRounds?.includes(roundIndex),
    rounds[roundIndex]?.bestOf,
    missedRoundOf(entry, roundIndex),
  );
}

/** The points of each counted round on one line, "8 · 6 · 2": "—" for a round the unit missed, a bye's points. */
export function compactRoundPoints(entry: Entry, roundIndexes: number[], rounds: Rounds = []): string {
  return roundIndexes.map((roundIndex) => cellsOf(entry, roundIndex, rounds).points).join(' · ');
}

/** "8 pts", "1 pt". */
function pointsText(points: string): string {
  return `${points} ${points === '1' ? 'pt' : 'pts'}`;
}

/** One counted round of a row, as read on a phone: "Round 2 · 75 · 1st · 8 pts", "Round 2 · Bye · 8 pts", "Round 2 · —". */
function roundLine(entry: Entry, roundIndex: number, label: string, rounds: Rounds): string {
  const result = entry.rounds?.find((candidate) => candidate.roundIndex === roundIndex);
  const absent = entry.absentRounds?.includes(roundIndex) === true;
  const cells = cellsOf(entry, roundIndex, rounds);
  if (absent) return `${label} · ABS · ${pointsText(cells.points)}`;
  if (!result) return missedRoundOf(entry, roundIndex) ? `${label} · ${cells.score}` : `${label} · —`;
  if (result.bye) return `${label} · ${cells.score} · ${pointsText(cells.points)}`;
  return `${label} · ${cells.score} · ${cells.rank} · ${pointsText(cells.points)}`;
}

/**
 * What a tapped standings row unfolds on a phone: one line per counted round (`labels` align with `roundIndexes`),
 * then the tie-break, with its two-decimal value where another unit on the same points shows the same whole percent
 * (`sharesPercent`, from `sharesWholePercent`): a phone has no hover to hold that value.
 */
export function standingsDetailLines(
  entry: Entry,
  roundIndexes: number[],
  labels: string[],
  sharesPercent: boolean,
  rounds: Rounds = [],
): string[] {
  const tieBreak = `Tie-break ${formatTieBreak(entry.roomShare)}`;
  const total = pointsCell(entry).detail;
  return [
    ...roundIndexes.map((roundIndex, position) => roundLine(entry, roundIndex, labels[position], rounds)),
    ...(total ? [total] : []),
    sharesPercent ? `${tieBreak} (${formatTieBreakPrecise(entry.roomShare)})` : tieBreak,
  ];
}
