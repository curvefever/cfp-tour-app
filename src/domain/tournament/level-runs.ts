/** A run of consecutive entries of a list, from index `first` to index `last` (both included). */
export interface LevelRun {
  first: number;
  last: number;
}

/**
 * Splits a list into runs of consecutive entries that are level with the first entry of their run (`level(entry,
 * first)`); an entry level with nobody is a run of its own. Every entry is in exactly one run, in order.
 */
export function levelRuns<T>(list: readonly T[], level: (entry: T, first: T) => boolean): LevelRun[] {
  const runs: LevelRun[] = [];
  let first = 0;
  while (first < list.length) {
    let last = first;
    while (last + 1 < list.length && level(list[last + 1], list[first])) last += 1;
    runs.push({ first, last });
    first = last + 1;
  }
  return runs;
}
