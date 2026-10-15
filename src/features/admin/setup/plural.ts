/** "1 room", "5 rooms"; pass the plural form when it is not the noun plus "s". */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}
