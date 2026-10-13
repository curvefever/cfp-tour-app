export const PRODUCTION_TOUR_HOSTNAME = 'tournaments.curvefever.pro';

export type TourEnvironment = 'prod' | 'test';

export function getTourEnvironment(hostname?: string): TourEnvironment {
  return hostname?.trim().toLowerCase() === PRODUCTION_TOUR_HOSTNAME ? 'prod' : 'test';
}

export function getTournamentRootPath(hostname?: string): string {
  return `environments/${getTourEnvironment(hostname)}/tournaments`;
}

export function getIndexRootPath(hostname?: string): string {
  return `environments/${getTourEnvironment(hostname)}/index`;
}

export function getSetupRootPath(hostname?: string): string {
  return `environments/${getTourEnvironment(hostname)}/setups`;
}

export function getPresenceRootPath(hostname?: string): string {
  return `environments/${getTourEnvironment(hostname)}/presence`;
}

export function getMediaRootPath(hostname?: string): string {
  return `environments/${getTourEnvironment(hostname)}/media`;
}

/** Every database path a tournament's data lives under. */
export interface TournamentPaths {
  tournament: string;
  index: string;
  setup: string;
  presence: string;
  media: string;
}

export function getTournamentPaths(tournamentId: string, hostname?: string): TournamentPaths {
  return {
    tournament: `${getTournamentRootPath(hostname)}/${tournamentId}`,
    index: `${getIndexRootPath(hostname)}/${tournamentId}`,
    setup: `${getSetupRootPath(hostname)}/${tournamentId}`,
    presence: `${getPresenceRootPath(hostname)}/${tournamentId}`,
    media: `${getMediaRootPath(hostname)}/${tournamentId}`,
  };
}
