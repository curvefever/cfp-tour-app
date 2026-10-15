import { plural } from './plural';

/** What loading the roster did: "37 confirmed, 1 reserve", with the individual reserves of a team format. */
export function rosterLoadStatus(confirmed: number, reserves: number, individualReserves?: number): string {
  const parts = [`${confirmed} confirmed`, plural(reserves, 'reserve')];
  if (individualReserves !== undefined) parts.push(plural(individualReserves, 'individual reserve'));
  return parts.join(', ');
}
