/** What the row rule reads of one card (a round, or rounds merged into one card). */
export interface RowEntity {
  column: number;
  isFinal: boolean;
  /** The order of the card's band among the pooling block's destinations (0 first), or null when the block does not feed it. */
  poolingOrder: number | null;
}

/** The players one card sends to another, by index in the entities. */
export interface RowFeed {
  from: number;
  to: number;
  count: number;
}

/**
 * The row of every card, from the top (row 0):
 *  1. the Final and every card with a band that sends players to it: row 0;
 *  2. a card the pooling block feeds: the order of its band among the block's destinations;
 *  3. any other card continues the row of the card that sends it the most players (a tie: the higher row);
 *  4. a row already held in the card's column goes to the next free row below.
 * The cards of rule 1 are placed first, so a major round keeps the top row of its column; the others follow in play order.
 */
export function assignRows(entities: readonly RowEntity[], feeds: readonly RowFeed[]): number[] {
  const rows: Array<number | undefined> = [];
  const sendsToFinal = (index: number) =>
    entities[index].isFinal || feeds.some((feed) => feed.from === index && entities[feed.to].isFinal);
  const held = (column: number, row: number) =>
    entities.some((entity, index) => entity.column === column && rows[index] === row);
  const place = (index: number, wanted: number) => {
    let row = wanted;
    while (held(entities[index].column, row)) row += 1;
    rows[index] = row;
  };
  const continued = (index: number): number => {
    const sent = new Map<number, number>();
    for (const feed of feeds) {
      if (feed.to === index && rows[feed.from] !== undefined) {
        sent.set(feed.from, (sent.get(feed.from) ?? 0) + feed.count);
      }
    }
    let best: { count: number; row: number } | null = null;
    for (const [from, count] of sent) {
      const row = rows[from] ?? 0;
      if (!best || count > best.count || (count === best.count && row < best.row)) best = { count, row };
    }
    return best?.row ?? 0;
  };
  entities.forEach((_, index) => {
    if (sendsToFinal(index)) place(index, 0);
  });
  entities.forEach((entity, index) => {
    if (rows[index] === undefined) place(index, entity.poolingOrder ?? continued(index));
  });
  return rows.map((row) => row ?? 0);
}
