import { roundGameCount, type RoundGameCount } from '../../../domain/tournament/bracket';
import type { TournamentState } from '../../../domain/tournament/types';

/** "1 GAME", "3 GAMES", "UP TO 4 GAMES" for the race Grand Final, "BEST OF 3" or "UNEVEN WINS 1 · 2" (the earlier finalist's target first). */
export function gameCountText({ games, upTo, bestOf, wins }: RoundGameCount): string {
  if (wins) return `UNEVEN WINS ${wins.join(' · ')}`;
  if (bestOf) return `BEST OF ${games}`;
  return `${upTo ? 'UP TO ' : ''}${games} ${games === 1 ? 'GAME' : 'GAMES'}`;
}

/** Whether the count is a match format the Bracket marks with a tag: a Best of N, uneven wins, or several summed games. */
export function isMatchFormatCount(count: RoundGameCount): boolean {
  return Boolean(count.bestOf || count.wins) || (!count.upTo && count.games > 1);
}

/** The match format of a round as its tag reads, or undefined when the round has none worth a tag (one game, the race Grand Final). */
export function roundMatchTag(state: TournamentState, roundIndex: number): string | undefined {
  const count = roundGameCount(state, roundIndex);
  return count && isMatchFormatCount(count) ? gameCountText(count) : undefined;
}
