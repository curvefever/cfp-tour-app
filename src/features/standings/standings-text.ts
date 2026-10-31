import { largestRoomSize, rankingPoints, roomPointsByPlace } from '../../domain/tournament/advancement';
import { usesGroupAverages } from '../../domain/tournament/group-standings';
import { matchResultSettings } from '../../domain/tournament/match-results';
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

/** "Each game: a win by more than 100 points earns 3, by 100 or less 2; a loss by 100 or less 1, by more 0; a tie 1.5." from the tournament's own values. */
function matchResultsSentence(state: TournamentState): string {
  const settings = matchResultSettings(state);
  if (!settings) return '';
  const [win, tieWin, tieLoss, loss] = settings.points;
  const margin = settings.tieMargin;
  const tie = formatStandingValue((tieWin + tieLoss) / 2);
  const bestOf = state.rounds.some((round) => round.isGroupStage && round.bestOf !== undefined)
    ? ' A Best of 3 counts as one match: 2–0 is a win, 2–1 a tie win.'
    : '';
  return `Each game: a win by more than ${margin} points earns ${win}, by ${margin} or less ${tieWin}; a loss by ${margin} or less ${tieLoss}, by more ${loss}; a tie ${tie}.${bestOf}`;
}

function pointsSentence(state: TournamentState): string {
  const { scoring, roomSize, pointsVersion } = state.gamemodeConfig;
  if (scoring === 'match-results' && matchResultSettings(state)) return matchResultsSentence(state);
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
  const perMatch = display.perGroup && usesGroupAverages(state);
  return [
    standingsProgressSentence(display),
    pointsSentence(state),
    [
      perMatch
        ? 'Groups are ranked by points per match played. A bye is not a match. A match against an absent or withdrawn opponent is void for the one that turned up; a no-show gets 0 for it.'
        : 'A bye counts as a win; a missed round earns 0.',
      nonCountingSentence(state),
    ]
      .filter(Boolean)
      .join(' '),
    perMatch
      ? `Most points per match ranks first. ${cutSentence(display)}`
      : `Points are added up; most points ranks first. ${cutSentence(display)}`,
    perMatch
      ? "On equal points per match, the tie-break is your results against each other, then how you scored compared with your rooms' average (100% = an average score in your room), and last the organiser's decision."
      : "On equal points, the tie-break is how you scored compared with your rooms' average (100% = an average score in your room).",
  ];
}

/** "2 wins", "1 win", "0 wins": a Best of N round's score cell. */
function winsText(wins: number): string {
  return `${wins} ${wins === 1 ? 'win' : 'wins'}`;
}

export interface RoundCells {
  score: string;
  rank: string;
  points: string;
}

/** What a counted round without a result of the unit's own was: a match void for it, or a bye (a group stage with per-match standings). */
export type MissedRound = 'void' | 'bye';

/** What a row's Points cell shows: points per match to two decimals with the total and matches under it, or the points total alone. */
export function pointsCell(entry: { totalFP: number | null; matches?: number; averagePoints?: number }): {
  main: string;
  detail: string | null;
} {
  if (entry.totalFP === null) return { main: '—', detail: null };
  if (entry.matches === undefined || entry.averagePoints === undefined) {
    return { main: formatStandingValue(entry.totalFP), detail: null };
  }
  const total = formatStandingValue(entry.totalFP);
  return {
    main: entry.averagePoints.toFixed(2),
    detail: `${total} ${total === '1' ? 'pt' : 'pts'} · ${entry.matches} played`,
  };
}

/**
 * One counted round of a table row. A bye shows "Bye" and its points; a round the unit missed (a late joiner's)
 * shows "—" throughout: it adds 0 to the total, but the cell says the unit was not there. A round the unit was
 * absent from reads "ABS" with 0 points. A Best of N round (`bestOf`, from the round) reads the games won, "2 wins",
 * where a summed round reads its score.
 */
export function roundCells(
  result: StandingRoundResult | undefined,
  absent = false,
  bestOf?: number,
  missed?: MissedRound,
): RoundCells {
  if (absent) return { score: 'ABS', rank: '—', points: '0' };
  if (!result && missed) return { score: missed === 'void' ? 'Void' : 'Bye', rank: '—', points: '—' };
  if (!result) return { score: '—', rank: '—', points: '—' };
  if (result.bye) return { score: 'Bye', rank: '—', points: formatStandingValue(result.points) };
  return {
    score: bestOf === undefined ? String(result.score) : winsText(result.score ?? 0),
    rank: result.results?.length
      ? result.results.join(' · ')
      : result.rank === null
        ? '—'
        : placeOrdinal({ place: result.rank, shared: result.shared === true }),
    points: formatStandingValue(result.points),
  };
}

/** Which kind of missed round a table entry has in a round, if any. */
export function missedRoundOf(
  entry: { voidRounds?: number[]; byeRounds?: number[] },
  roundIndex: number,
): MissedRound | undefined {
  if (entry.voidRounds?.includes(roundIndex)) return 'void';
  return entry.byeRounds?.includes(roundIndex) ? 'bye' : undefined;
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
  return sharesWholePercent(
    entries.map((entry) => ({ points: rankingPoints(entry), share: entry.roomShare })),
  );
}
