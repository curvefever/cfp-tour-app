/**
 * A name as the swap record follows it: the name itself, then the unit that replaced it, then the one that replaced
 * that, and so on, at most `maxMoves` replacements deep (a stored record can loop). `successorOf` is the record's
 * answer for one name, `undefined` when nothing replaced it. The callers differ in how they read the record and what
 * they ask of the chain: `currentUnit` the first name that is still registered, `groupSeats` the last name.
 */
export function* swapChain(
  successorOf: (name: string) => string | undefined,
  name: string,
  maxMoves: number,
): Generator<string> {
  let current = name;
  yield current;
  for (let moves = 0; moves < maxMoves; moves += 1) {
    const next = successorOf(current);
    if (next === undefined) return;
    current = next;
    yield current;
  }
}
