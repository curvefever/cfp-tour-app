import { largestRoomSize } from '../../domain/tournament/advancement';
import { formatStandingValue, standardPoints } from '../../domain/tournament/scoring';
import type { StandingsDisplay, StandingsDisplayTable } from '../../domain/tournament/standings-display';
import type { StandingRoundResult, TournamentState } from '../../domain/tournament/types';
import { ordinal, placeOrdinal } from '../../lib/ordinal';

/** Where the standings are: how many rounds are in, that they are final, or when they start. */
export function standingsProgressSentence(display: StandingsDisplay): string {
  if (display.phase === 'upcoming') return `Standings start after Round ${display.firstCountedRoundNum}.`;
  if (display.phase === 'final') return 'These are the final standings.';
  return `After ${display.roundsDone} of ${display.roundsTotal} rounds.`;
}

/** Points earned by each place, 1st first: the organiser's table under Custom points, else the largest room size down to 1. */
export function pointsPerPlace(state: TournamentState): number[] {
  if (state.gamemodeConfig.scoring === 'positional-points')
    return state.gamemodeConfig.positionalPointsTable ?? [];
  const largestRoom = largestRoomSize(state);
  return Array.from({ length: largestRoom }, (_, index) => standardPoints(index + 1, largestRoom));
}

function pointsSentence(state: TournamentState): string {
  const points = pointsPerPlace(state);
  const { scoring, roomSize } = state.gamemodeConfig;
  if (roomSize?.max === 2)
    return `Each counted round, a win earns ${points[0]} points and a loss ${points[1]}.`;
  const places = points.map((value, index) => `${ordinal(index + 1)} = ${value}`).join(', ');
  if (scoring === 'positional-points') {
    return `Each counted round, your place in your room earns points from the organiser's table: ${places}.`;
  }
  const sizeNote = roomSize && roomSize.min === roomSize.max ? '' : ', whatever the size of your room';
  return `Each counted round, your place in your room earns points: ${places}${sizeNote}.`;
}

/** "Round 1 doesn't count." / "Rounds 1–2 don't count."; empty when every round counts. */
function nonCountingSentence(state: TournamentState): string {
  const roundNums = state.rounds.filter((round) => round.excludeFromStandings).map((round) => round.roundNum);
  if (roundNums.length === 0) return '';
  return roundNums.length === 1
    ? `Round ${roundNums[0]} doesn't count.`
    : `Rounds ${roundNums[0]}–${roundNums[roundNums.length - 1]} don't count.`;
}

function cutSentence(display: StandingsDisplay): string {
  const cut = display.tables[0]?.cut ?? null;
  const verb = display.phase === 'final' ? 'qualified' : 'go through';
  if (cut === null) return display.phase === 'final' ? 'Everyone qualified.' : 'Everyone goes through.';
  return display.perGroup ? `The top ${cut} of each group ${verb}.` : `The top ${cut} ${verb}.`;
}

/**
 * The written explanation of the Standings table, one string per paragraph, starting with where the standings are.
 * Every figure (points per place, the cut, the non-counting rounds) comes from the tournament's own settings.
 */
export function standingsExplanation(state: TournamentState, display: StandingsDisplay): string[] {
  return [
    standingsProgressSentence(display),
    pointsSentence(state),
    ['A bye counts as a win; a missed round earns 0.', nonCountingSentence(state)].filter(Boolean).join(' '),
    `Points are added up; most points ranks first. ${cutSentence(display)}`,
    "On equal points, the tie-break is how you scored compared with your rooms' average (100% = an average score in your room).",
  ];
}

export interface RoundCells {
  score: string;
  rank: string;
  points: string;
}

/**
 * One counted round of a table row. A bye shows "Bye" and its points; a round the unit missed (a late joiner's)
 * shows "—" throughout: it adds 0 to the total, but the cell says the unit was not there.
 */
export function roundCells(result: StandingRoundResult | undefined): RoundCells {
  if (!result) return { score: '—', rank: '—', points: '—' };
  if (result.bye) return { score: 'Bye', rank: '—', points: formatStandingValue(result.points) };
  return {
    score: String(result.score),
    rank: result.rank === null ? '—' : placeOrdinal({ place: result.rank, shared: result.shared === true }),
    points: formatStandingValue(result.points),
  };
}

/** The tie-break to two decimals ("1.37%"), for the hover on the whole percent; "—" without a played round. */
export function formatTieBreakPrecise(roomShare: number | null | undefined): string {
  return roomShare === null || roomShare === undefined ? '—' : `${(roomShare * 100).toFixed(2)}%`;
}

/**
 * Which units show the same points and the same whole tie-break percent as another unit of the list: for them
 * the whole percent does not tell the order, so the cell hints that the hover holds more.
 */
export function sharesWholePercent(
  units: Array<{ points: number | null; share: number | null | undefined }>,
): boolean[] {
  const keyOf = (unit: (typeof units)[number]) =>
    unit.share === null || unit.share === undefined
      ? null
      : `${unit.points === null ? 'none' : formatStandingValue(unit.points)}|${formatTieBreak(unit.share)}`;
  const counts = new Map<string, number>();
  for (const unit of units) {
    const key = keyOf(unit);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return units.map((unit) => {
    const key = keyOf(unit);
    return key !== null && (counts.get(key) ?? 0) > 1;
  });
}

/** The tie-break as a whole percent of the room average ("147%"); "—" when the unit has no played round. */
export function formatTieBreak(roomShare: number | null | undefined): string {
  return roomShare === null || roomShare === undefined ? '—' : `${Math.round(roomShare * 100)}%`;
}

/** A counted round's name in a standings table's header and in a phone row's detail: "Round 3". */
export function standingsRoundLabel(state: TournamentState, roundIndex: number): string {
  return `Round ${state.rounds[roundIndex].roundNum}`;
}

/** `sharesWholePercent` for the entries of one standings table, as every display of it asks. */
export function entriesSharingPercent(entries: StandingsDisplayTable['entries']): boolean[] {
  return sharesWholePercent(entries.map((entry) => ({ points: entry.totalFP, share: entry.roomShare })));
}
