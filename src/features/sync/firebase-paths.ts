export const PRODUCTION_TOUR_HOSTNAME = 'tournaments.curvefever.pro';

export type TourEnvironment = 'prod' | 'test';

export function getTourEnvironment(hostname?: string): TourEnvironment {
  return hostname?.trim().toLowerCase() === PRODUCTION_TOUR_HOSTNAME ? 'prod' : 'test';
}

export function getTournamentRootPath(hostname?: string): string {
  return `environments/${getTourEnvironment(hostname)}/tournaments`;
}
