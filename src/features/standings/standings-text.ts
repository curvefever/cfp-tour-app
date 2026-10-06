import { largestRoomSize } from '../../domain/tournament/advancement';
import { standardPoints } from '../../domain/tournament/scoring';
import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import type { StandingRoundResult, TournamentState } from '../../domain/tournament/types';
import { ordinal } from '../../lib/ordinal';

/** Context line shared by the Standings tab and the Bracket column: where the standings are and what they decide. */
export function standingsContextLine(display: StandingsDisplay): string {
  const cut = display.tables[0]?.cut ?? null;
  if (display.phase === 'upcoming') return `Standings start after Round ${display.firstCountedRoundNum}.`;
  const perGroup = display.perGroup ? 'per group ' : '';
  if (display.phase === 'final') {
    return cut === null
      ? 'Final standings · everyone qualified'
      : `Final standings · top ${cut} ${perGroup}qualified`;
  }
  const progress = `After ${display.roundsDone} of ${display.roundsTotal} rounds`;
  return cut === null
    ? `${progress} · everyone goes through`
    : `${progress} · top ${cut} ${perGroup}go through`;
}

/** Points earned by each place, 1st first: the organiser's table under Custom points, else the largest room size down to 1. */
function pointsPerPlace(state: TournamentState): number[] {
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
 * The written explanation of the Standings table, one string per paragraph. Every figure (points per place, the
 * cut, the non-counting rounds) comes from the tournament's own settings.
 */
export function standingsExplanation(state: TournamentState, display: StandingsDisplay): string[] {
  return [
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
 * One counted round of a table row. A bye shows "Bye" and its points; a round the unit missed shows 0 points once
 * the round is over, and nothing while it is still ahead or being played.
 */
export function roundCells(result: StandingRoundResult | undefined, roundOver: boolean): RoundCells {
  if (!result) return { score: '—', rank: '—', points: roundOver ? '0' : '—' };
  if (result.bye) return { score: 'Bye', rank: '—', points: String(result.points) };
  return {
    score: String(result.score),
    rank: result.rank === null ? '—' : ordinal(result.rank),
    points: String(result.points),
  };
}

/** The tie-break as a whole percent of the room average ("147%"); "—" when the unit has no played round. */
export function formatTieBreak(roomShare: number | null | undefined): string {
  return roomShare === null || roomShare === undefined ? '—' : `${Math.round(roomShare * 100)}%`;
}
