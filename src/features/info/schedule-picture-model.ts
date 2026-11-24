import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { declaredSchedule } from '../../domain/tournament/declared-schedule';
import { getGameFormat } from '../../domain/tournament/formats';
import { roundExitRule, type RoundExitRule } from '../../domain/tournament/room-exits';
import { isHeadToHeadRoom } from '../../domain/tournament/upper-lower-wins';
import { roundColumn } from '../../domain/tournament/round-columns';
import type { TournamentState } from '../../domain/tournament/types';
import { unitCountLabel } from '../tournaments/tournaments-list';
import { headerTone, type Feed } from './schedule-picture-header-tone';
import { cardGroups, mergeKey, mergedName, roomCount, subLine } from './schedule-picture-merge';
import { isPoolingRule, poolingPicture } from './schedule-picture-pooling';
import { roundPicture, type RoundPicture } from './schedule-picture-round';
import { assignRows, type RowEntity, type RowFeed } from './schedule-picture-rows';
import type { Route } from './schedule-picture-routes';
import type { PictureCard, PictureTone, PictureUnits, SchedulePictureModel } from './schedule-picture-types';

/** The pooling block's column, before the first column of the bracket. */
const POOLING_COLUMN = -1;

/** What the picture is titled with: the tournament's name and the format line the Info tab shows. */
export interface PictureHeader {
  title: string;
  formatLine: string;
}

/** The bracket round's column among the bracket's columns, from 0, read from where the rounds are played together. */
function columnsOf(state: TournamentState, bracket: number[]): Map<number, number> {
  const starts = [...new Set(bracket.map((index) => roundColumn(state.rounds, index).start))].sort(
    (first, second) => first - second,
  );
  return new Map(bracket.map((index) => [index, starts.indexOf(roundColumn(state.rounds, index).start)]));
}

/** What the rounds of the bracket and the pooling block send each bracket round, with the column that sends it. */
function feedsOf(
  rounds: readonly RoundPicture[],
  columns: ReadonlyMap<number, number>,
  poolingRoutes: readonly Route[],
): Map<number, Feed[]> {
  const feeds = new Map<number, Feed[]>();
  const add = (to: number, feed: Feed) => feeds.set(to, [...(feeds.get(to) ?? []), feed]);
  poolingRoutes.forEach((route) => add(route.to, { column: POOLING_COLUMN, tone: route.tone }));
  for (const round of rounds) {
    for (const route of round.routes)
      add(route.to, { column: columns.get(round.index) ?? 0, tone: route.tone });
  }
  return feeds;
}

/** The rounds of a column that are drawn as one card: same column, format, sizes and blocks. */
function entitiesOf(rounds: readonly RoundPicture[], columns: ReadonlyMap<number, number>): RoundPicture[][] {
  const entities = new Map<string, RoundPicture[]>();
  for (const round of rounds) {
    const key = `${columns.get(round.index)}|${mergeKey(round)}`;
    entities.set(key, [...(entities.get(key) ?? []), round]);
  }
  return [...entities.values()];
}

function rowFeeds(entities: readonly RoundPicture[][]): RowFeed[] {
  const entityOf = new Map<number, number>();
  entities.forEach((rounds, entity) => rounds.forEach((round) => entityOf.set(round.index, entity)));
  const feeds = new Map<string, RowFeed>();
  entities.forEach((rounds, from) => {
    for (const route of rounds.flatMap((round) => round.routes)) {
      const to = entityOf.get(route.to);
      if (to === undefined || to === from) continue;
      const key = `${from}|${to}|${route.drop === true}`;
      const known = feeds.get(key);
      if (known) known.count += route.count;
      else feeds.set(key, { from, to, count: route.count, ...(route.drop ? { drop: true } : {}) });
    }
  });
  return [...feeds.values()];
}

function cardOf(
  rounds: readonly RoundPicture[],
  column: number,
  row: number,
  tone: PictureTone,
  units: PictureUnits,
): PictureCard {
  const rooms = roomCount(rounds);
  return {
    name: mergedName(rounds.map((round) => round.label)),
    tone,
    // A head-to-head card counts its matches in the sub line.
    tag: rooms > 1 && !units.headToHead ? `×${rooms}` : null,
    sub: subLine(rounds, units.team, units.headToHead),
    groups: cardGroups(rounds, units.team),
    column,
    row,
    rounds: rounds.map((round) => round.index),
  };
}

/**
 * The schedule picture's content, from the schedule as declared (`state.rounds`, never a drawn line-up): the pooling
 * block, then one card per round of the bracket (rounds of a column with the same exits are one card) on its column
 * and row. Null while there are no rounds. It only describes `roundExitRule` and its neighbours; it decides nothing.
 */
export function schedulePictureModel(
  state: TournamentState,
  header: PictureHeader,
): SchedulePictureModel | null {
  if (state.rounds.length === 0) return null;
  const declared = declaredSchedule(state);
  const labels = bracketRoundLabels(declared);
  const units: PictureUnits = {
    team: getGameFormat(state.gameFormat)?.unitLabelPlural === 'Teams',
    headToHead: state.gamemodeConfig.roomSize ? isHeadToHeadRoom(state.gamemodeConfig.roomSize) : false,
  };
  const rules: RoundExitRule[] = state.rounds.map((_, index) => roundExitRule(declared, index));
  const indices = rules.map((_, index) => index);
  const pooling = indices.filter((index) => isPoolingRule(rules[index]));
  const bracket = indices.filter((index) => !isPoolingRule(rules[index]));

  const poolingBlock = poolingPicture(
    state,
    declared,
    pooling,
    pooling.map((index) => rules[index]),
    units,
  );
  const columns = columnsOf(declared, bracket);
  const rounds = bracket.map((index) =>
    roundPicture(declared, index, rules[index], labels[index].label, labels),
  );
  const feeds = feedsOf(rounds, columns, poolingBlock?.routes ?? []);
  const entities = entitiesOf(rounds, columns);

  const poolingDestinations = [...new Set((poolingBlock?.routes ?? []).map((route) => route.to))];
  const poolingOrderOf = (members: readonly RoundPicture[]): number | null => {
    const orders = members
      .map((round) => poolingDestinations.indexOf(round.index))
      .filter((order) => order >= 0);
    return orders.length ? Math.min(...orders) : null;
  };
  const rowEntities: RowEntity[] = entities.map((members) => ({
    column: columns.get(members[0].index) ?? 0,
    isFinal: members.some((round) => declared.rounds[round.index].isFinal),
    ranking: members.every((round) => declared.rounds[round.index].waterfallRanking === true),
    poolingOrder: poolingOrderOf(members),
  }));
  const rows = assignRows(rowEntities, rowFeeds(entities));

  return {
    header: {
      title: header.title,
      formatLine: header.formatLine,
      count: unitCountLabel({ gameFormat: state.gameFormat, unitCount: state.players.length }),
    },
    pooling: poolingBlock?.block ?? null,
    cards: entities.map((members, entity) =>
      cardOf(
        members,
        rowEntities[entity].column,
        rows[entity],
        headerTone(members.flatMap((round) => feeds.get(round.index) ?? [])),
        units,
      ),
    ),
  };
}
