import { getGameFormat } from '../../domain/tournament/formats';
import type { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { scheduledDay } from '../tournaments/tournament-info';

type Rankings = NonNullable<ReturnType<typeof computeRankings>>;

/** The words of the image's header, before any drawing. */
export interface ImageHeaderText {
  label: 'FINAL RANKINGS' | 'LIVE RANKINGS';
  live: boolean;
  title: string;
  /** "Sunday 18 October 2026"; null when the tournament has no scheduled date. */
  date: string | null;
  /** "37 players", "13 teams · 39 players", "1 player". */
  count: string;
  /** "12 still in" while the tournament runs; null once the Final is played. */
  stillIn: string | null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The units the image lists, each with its members (null for a player): those still in, the finalists (once the
 * Final is played), the eliminated and the withdrawn who played. Reserves who never joined are not listed.
 */
function listedUnits(data: Rankings): { members: string[] | null }[] {
  return [...data.stillActive, ...data.finalists, ...data.eliminatedList, ...data.dnfList];
}

function countText(state: TournamentState, data: Rankings): string {
  const units = listedUnits(data);
  const players = units.reduce((sum, unit) => sum + (unit.members?.length ?? 1), 0);
  const format = getGameFormat(state.gameFormat);
  if (!format?.teamSize) return plural(players, 'player');
  return `${plural(units.length, format.unitLabel.toLowerCase())} · ${plural(players, 'player')}`;
}

/** What the header of the rankings image says: the label, the title, the day, how many took part. */
export function rankingsImageHeader(
  state: TournamentState,
  data: Rankings,
  options: { timeZone?: string } = {},
): ImageHeaderText {
  const scheduledAt = state.info?.scheduledAt ?? null;
  return {
    label: data.finalComplete ? 'FINAL RANKINGS' : 'LIVE RANKINGS',
    live: !data.finalComplete,
    title: state.title.trim() || 'Unnamed Tournament',
    date: scheduledAt === null ? null : scheduledDay(scheduledAt, options),
    count: countText(state, data),
    stillIn: data.finalComplete ? null : `${data.stillActive.length} still in`,
  };
}
