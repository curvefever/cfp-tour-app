import { findUnstorableNames, unstorableNamesMessage } from '../../domain/tournament/roster';

/** Tells the organiser which of `names` can't be stored and returns true, so the caller changes nothing. */
export function refuseUnstorableNames(names: readonly string[]): boolean {
  const offenders = findUnstorableNames(names);
  if (!offenders.length) return false;
  window.alert(unstorableNamesMessage(offenders));
  return true;
}
