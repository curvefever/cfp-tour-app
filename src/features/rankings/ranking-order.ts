/**
 * Units in the order Rankings lists those still in: alphabetical by the name shown, with the numbers inside a name
 * counted as numbers ("Team 2" before "Team 10", "Player 9" before "Player 10"). The ranking itself is untouched.
 */
export function naturalByLabel<T extends { label: string }>(units: readonly T[]): T[] {
  return [...units].sort((first, second) =>
    first.label.localeCompare(second.label, undefined, { numeric: true }),
  );
}
