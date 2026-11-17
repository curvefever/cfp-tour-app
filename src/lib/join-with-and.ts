/** "A", "A and B", "A, B and C" (no serial comma). */
export function joinWithAnd(parts: readonly string[]): string {
  return parts.length < 2
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
