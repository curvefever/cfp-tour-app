import { largestRoomSize, roomPointsByPlace } from '../../domain/tournament/advancement';
import { formatStandingValue } from '../../domain/tournament/scoring';
import {
  isCountedRound,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { StandingRoundResult, TournamentState } from '../../domain/tournament/types';
import { ordinal, placeOrdinal } from '../../lib/ordinal';

/** Where the standings are: how many rounds are in, that they are final, or when they start. */
export function standingsProgressSentence(display: StandingsDisplay): string {
  if (display.phase === 'upcoming') return `Standings start after Round ${display.firstCountedRoundNum}.`;
  if (display.phase === 'final') return 'These are the final standings.';
  return `After ${display.roundsDone} of ${display.roundsTotal} rounds.`;
}

/** "1st = 10, 2nd = 8, …": the places of a room with what each earns. */
function placesList(points: readonly number[]): string {
  return points.map((value, index) => `${ordinal(index + 1)} = ${value}`).join(', ');
}

/** The sizes of the rooms played in counted rounds that are smaller than the largest room, largest first. */
function smallerRoomSizes(state: TournamentState, largestRoom: number): number[] {
  const sizes = state.rounds.filter(isCountedRound).flatMap((round) => round.rooms);
  return [...new Set(sizes)].filter((size) => size >= 2 && size < largestRoom).sort((a, b) => b - a);
}

/** One sentence per smaller room size of the counted rounds, for a tournament that scales points to the room. */
function smallerRoomSentences(state: TournamentState, largestRoom: number): string[] {
  return smallerRoomSizes(state, largestRoom).map(
    (size) =>
      `In a room of ${size}: ${placesList(roomPointsByPlace(state, size))} (places spread evenly between first and last).`,
  );
}

function pointsSentence(state: TournamentState): string {
  const { scoring, roomSize, pointsVersion } = state.gamemodeConfig;
  const largestRoom = largestRoomSize(state);
  const points = roomPointsByPlace(state, largestRoom);
  if (roomSize?.max === 2)
    return `Each counted round, a win earns ${points[0]} points and a loss ${points[1]}.`;
  const places = placesList(points);
  const source = scoring === 'positional-points' ? " from the organiser's table" : '';
  if (pointsVersion === 2) {
    return [
      `Each counted round, your place in your room earns points${source}: ${places}.`,
      ...smallerRoomSentences(state, largestRoom),
    ].join(' ');
  }
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
 * shows "—" throughout: it adds 0 to the total, but the cell says the unit was not there. A round the unit was
 * absent from reads "ABS" with 0 points.
 */
export function roundCells(result: StandingRoundResult | undefined, absent = false): RoundCells {
  if (absent) return { score: 'ABS', rank: '—', points: '0' };
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
