import { publishMissing, stateSubject, type PublishMissing } from '../tournaments/admin-actions';
import { useTournamentApp } from '../tournament/TournamentProvider';

const NOTHING_MISSING: PublishMissing[] = [];

/** What the loaded draft still lacks before it can be published (nothing for any other status); the fields outline it. */
export function usePublishMissing(): PublishMissing[] {
  const { state } = useTournamentApp();
  const subject = stateSubject(state);
  return subject?.status === 'draft' ? publishMissing(subject) : NOTHING_MISSING;
}
