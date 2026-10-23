import type { StandingsDisplayTable } from '../../domain/tournament/standings-display';
import { formatTieBreak, formatTieBreakPrecise, roundCells } from './standings-text';

type Entry = StandingsDisplayTable['entries'][number];

function cellsOf(entry: Entry, roundIndex: number) {
  return roundCells(entry.rounds?.find((result) => result.roundIndex === roundIndex));
}

/** The points of each counted round on one line, "8 · 6 · 2": "—" for a round the unit missed, a bye's points. */
export function compactRoundPoints(entry: Entry, roundIndexes: number[]): string {
  return roundIndexes.map((roundIndex) => cellsOf(entry, roundIndex).points).join(' · ');
}

/** "8 pts", "1 pt". */
function pointsText(points: string): string {
  return `${points} ${points === '1' ? 'pt' : 'pts'}`;
}

/** One counted round of a row, as read on a phone: "Round 2 · 75 · 1st · 8 pts", "Round 2 · Bye · 8 pts", "Round 2 · —". */
function roundLine(entry: Entry, roundIndex: number, label: string): string {
  const result = entry.rounds?.find((candidate) => candidate.roundIndex === roundIndex);
  const cells = roundCells(result);
  if (!result) return `${label} · —`;
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
): string[] {
  const tieBreak = `Tie-break ${formatTieBreak(entry.roomShare)}`;
  return [
    ...roundIndexes.map((roundIndex, position) => roundLine(entry, roundIndex, labels[position])),
    sharesPercent ? `${tieBreak} (${formatTieBreakPrecise(entry.roomShare)})` : tieBreak,
  ];
}
