import { getRequest } from '@tanstack/react-start/server';
import { BUILD_HEADER, outdatedBuildRefusal, TOUR_BUILD_ID } from './build-id';

/** Refuses a call from a tab loaded with another build: it would write with that build's rules. */
export function requireCurrentBuild(): void {
  const refusal = outdatedBuildRefusal(getRequest().headers.get(BUILD_HEADER), TOUR_BUILD_ID);
  if (refusal) throw new Error(refusal);
}
