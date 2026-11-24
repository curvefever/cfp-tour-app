import { roundGameCount } from '../../domain/tournament/bracket';
import type { RoundExitRule } from '../../domain/tournament/room-exits';
import type { TournamentState } from '../../domain/tournament/types';
import { roundGamesText } from '../tournament/components/round-games-text';
import type { BlockContext } from './schedule-picture-bands';
import { roomGroups, type RoomGroup } from './schedule-picture-groups';
import { roundRoutes, type Route } from './schedule-picture-routes';

/** One bracket round, read from the declared schedule. */
export interface RoundPicture {
  index: number;
  label: string;
  /** The declared room sizes; empty for a round of matches. */
  rooms: number[];
  matches: number;
  /** "1 game", "3 games", "best of 3". */
  format: string;
  groups: RoomGroup[];
  routes: Route[];
}

export function roundPicture(
  declared: TournamentState,
  index: number,
  rule: RoundExitRule,
  label: string,
  labels: BlockContext['labels'],
): RoundPicture {
  const round = declared.rounds[index];
  const games = roundGameCount(declared, index);
  return {
    index,
    label,
    rooms: round.rooms,
    matches: round.rooms.length === 0 ? (round.matches?.length ?? 0) : 0,
    format: games ? roundGamesText(games) : '1 game',
    groups: roomGroups(round, index, rule, labels),
    routes: rule.kind === 'per-room' ? roundRoutes(round, index, rule) : [],
  };
}
