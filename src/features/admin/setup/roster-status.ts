import { plural } from './plural';

/** What loading the roster did: "37 registered, 1 reserve", with the individual reserves of a team format. */
export function rosterLoadStatus(registered: number, reserves: number, individualReserves?: number): string {
  const parts = [`${registered} registered`, plural(reserves, 'reserve')];
  if (individualReserves !== undefined) parts.push(plural(individualReserves, 'individual reserve'));
  return parts.join(', ');
}
