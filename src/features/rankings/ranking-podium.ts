import { bracketRoundLabels } from '../../domain/tournament/bracket';
import type { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { destinationLabel } from '../bracket/exit-text';
import { eliminatedWhere, finalistWhere, WITHDRAWN_WHERE } from './ranking-where';

type Rankings = NonNullable<ReturnType<typeof computeRankings>>;
export type Medal = 'gold' | 'silver' | 'bronze';

/** One of the three cards of the podium. */
export interface PodiumCard {
  key: string;
  rank: number;
  label: string;
  members: string[] | null;
  /** "Final · 429 over 3 games" for a finalist, where the unit went out for anybody else. */
  line: string;
  medal: Medal;
}

/** One line of the list under the podium: everybody from the fourth entry down, the withdrawn last. */
export interface FinishRow {
  key: string;
  rank: string;
  label: string;
  members: string[] | null;
  where: string;
}

export interface FinalStanding {
  /** In the order they stand on the podium: second, first, third (fewer when the tournament had fewer units). */
  podium: PodiumCard[];
  /** The same first three entries in order of place: first, second, third. */
  top: PodiumCard[];
  rest: FinishRow[];
}

function medalOf(rank: number): Medal {
  return rank <= 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "Final · 429 over 3 games" (just "Final · 429" for a single game); the race Grand Final counts the games won. */
function finalistLine(data: Rankings, roundName: string, total: number): string {
  if (data.lastRound.bracket === 'grand-final') return `${roundName} · ${plural(total, 'game')} won`;
  const games = data.lastRound.numGames ?? 1;
  return games === 1 ? `${roundName} · ${total}` : `${roundName} · ${total} over ${games} games`;
}

/**
 * What Rankings shows once the Final is played: a podium of the first three entries (finalists, then those
 * eliminated latest) and the list of everyone else. Units level on a rank keep the same number, podium included;
 * the withdrawn come last with no number.
 */
export function finalStanding(state: TournamentState, data: Rankings): FinalStanding {
  const labels = bracketRoundLabels(state);
  const roundName = destinationLabel(data.lastRi, labels);
  const entries = [
    ...data.finalists.map((unit) => ({
      key: unit.name,
      rank: unit.rank,
      label: unit.label,
      members: unit.members,
      line: finalistLine(data, roundName, unit.total),
      where: finalistWhere(data.lastRi, unit, labels),
    })),
    ...data.eliminatedList.map((unit) => {
      const where = eliminatedWhere(state, unit, labels);
      return {
        key: unit.name,
        rank: unit.rank,
        label: unit.label,
        members: unit.members,
        line: where,
        where,
      };
    }),
  ];
  const cards: PodiumCard[] = entries.slice(0, 3).map((entry) => ({
    key: entry.key,
    rank: entry.rank,
    label: entry.label,
    members: entry.members,
    line: entry.line,
    medal: medalOf(entry.rank),
  }));
  const [first, second, third] = cards;
  const podium = [second, first, third].filter((card): card is PodiumCard => card !== undefined);
  const rest: FinishRow[] = [
    ...entries.slice(3).map((entry) => ({
      key: entry.key,
      rank: String(entry.rank),
      label: entry.label,
      members: entry.members,
      where: entry.where,
    })),
    ...data.dnfList.map((unit) => ({
      key: `dnf-${unit.name}`,
      rank: '—',
      label: unit.label,
      members: unit.members,
      where: WITHDRAWN_WHERE,
    })),
  ];
  return { podium, top: cards, rest };
}
