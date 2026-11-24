/** What the row rule reads of one card (a round, or rounds merged into one card). */
export interface RowEntity {
  column: number;
  isFinal: boolean;
  /** A round whose units only play for places (`waterfallRanking`). */
  ranking: boolean;
  /** The order of the card's band among the pooling block's destinations (0 first), or null when the block does not feed it. */
  poolingOrder: number | null;
}

/** The players one card sends to another, by index in the entities; `drop` when they go down to the losers' side. */
export interface RowFeed {
  from: number;
  to: number;
  count: number;
  drop?: boolean;
}

/**
 * The row of every card, from the top (row 0):
 *  1. a card the pooling block feeds takes the order of its band among the block's destinations;
 *  2. the Final and every other card with a band that sends players to it: row 0;
 *  3. any other card continues the row of the card that sends it the most players (a tie: the higher row), the
 *     players it gets through a drop counting at the row below the sender's;
 *  4. a row already held in the card's column goes to the next free row below.
 * Cards are placed in that order, so a major round keeps the top row of its column; the rest follow by column and play
 * order, a round that only plays for places after the others of its column.
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
    const sent = new Map<string, { count: number; row: number }>();
    for (const feed of feeds) {
      const fromRow = rows[feed.from];
      if (feed.to !== index || fromRow === undefined) continue;
      const row = fromRow + (feed.drop ? 1 : 0);
      const key = `${feed.from}|${row}`;
      sent.set(key, { row, count: (sent.get(key)?.count ?? 0) + feed.count });
    }
    let best: { count: number; row: number } | null = null;
    for (const candidate of sent.values()) {
      if (
        !best ||
        candidate.count > best.count ||
        (candidate.count === best.count && candidate.row < best.row)
      ) {
        best = candidate;
      }
    }
    return best?.row ?? 0;
  };
  const unplaced = () => entities.map((_, index) => index).filter((index) => rows[index] === undefined);
  for (const index of unplaced()) {
    const { poolingOrder, ranking } = entities[index];
    if (poolingOrder !== null && !ranking) place(index, poolingOrder);
  }
  for (const index of unplaced()) {
    if (sendsToFinal(index) && !entities[index].ranking) place(index, 0);
  }
  const rest = unplaced().sort((first, second) => {
    const [a, b] = [entities[first], entities[second]];
    return a.column - b.column || Number(a.ranking) - Number(b.ranking) || first - second;
  });
  for (const index of rest) place(index, entities[index].poolingOrder ?? continued(index));
  return rows.map((row) => row ?? 0);
}
