import { bracketRoundLabels } from '../../domain/tournament/bracket';
import type { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { naturalByLabel } from './ranking-order';
import { finalStanding, type Medal } from './ranking-podium';
import { eliminatedRankText, eliminatedWhere, stillInWhere, WITHDRAWN_WHERE } from './ranking-where';

type Rankings = NonNullable<ReturnType<typeof computeRankings>>;

/** One line of the rankings image. */
export interface ImageRow {
  /** The place ("" for a unit still in, "—" for a withdrawn one). */
  rank: string;
  /** Set for the first three places of a finished tournament. */
  medal: Medal | null;
  name: string;
  /** Where the unit stands or went out, muted at the right of the line. */
  where: string;
}

/**
 * The lines of the image, in the order the page lists them: after the Final everybody from first place down; while
 * the tournament runs those still in (alphabetical), then the eliminated by place, then the withdrawn.
 */
export function rankingsImageRows(state: TournamentState, data: Rankings): ImageRow[] {
  if (data.finalComplete) {
    const { rest, top } = finalStanding(state, data);
    return [
      ...top.map((card) => ({
        rank: String(card.rank),
        medal: card.medal,
        name: card.label,
        where: card.line,
      })),
      ...rest.map((row) => ({ rank: row.rank, medal: null, name: row.label, where: row.where })),
    ];
  }
  const labels = bracketRoundLabels(state);
  return [
    ...naturalByLabel(data.stillActive).map((unit) => ({
      rank: '',
      medal: null,
      name: unit.label,
      where: stillInWhere(state, data.lastRi, unit, labels),
    })),
    ...data.eliminatedList.map((unit) => ({
      rank: eliminatedRankText(unit),
      medal: null,
      name: unit.label,
      where: eliminatedWhere(state, unit, labels),
    })),
    ...data.dnfList.map((unit) => ({ rank: '—', medal: null, name: unit.label, where: WITHDRAWN_WHERE })),
  ];
}
