import type { RoundGameCount } from '../../../domain/tournament/bracket';

/** "uneven wins 3 · 2", "best of 3", "up to 2 games", "3 games": how many games a round is played over, in words. */
export function roundGamesText(games: RoundGameCount): string {
  if (games.wins) return `uneven wins ${games.wins.join(' · ')}`;
  if (games.bestOf) return `best of ${games.games}`;
  return `${games.upTo ? 'up to ' : ''}${games.games} ${games.games === 1 ? 'game' : 'games'}`;
}
