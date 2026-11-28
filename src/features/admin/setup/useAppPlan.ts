import { useMemo } from 'react';
import { rosterKeys } from '../../../domain/tournament/roster';
import { previewRuntime, previewSchedule } from '../../../domain/tournament/schedule-preview';
import { createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { useTournamentApp } from '../../tournament/TournamentProvider';

/** The most units a typed head count is worked out for: a layered bracket's plan takes seconds at a few hundred. */
export const MAX_TYPED_COUNT = 200;

/** A typed head count: a positive whole number; anything else, an empty field included, is none. */
function typedHeadCount(typed: string | null): number | null {
  return typed !== null && /^[1-9]\d*$/.test(typed) ? Number(typed) : null;
}

/**
 * The app's plan for a head count: the typed one, else the loaded roster's. `typed` is the head count field as this tab
 * has it (null while untouched); it is stored nowhere. The plan follows the Setup form, not the generated schedule.
 */
export function useAppPlan(typed: string | null, lbQualifiers: string) {
  const { state, setup } = useTournamentApp();
  const { players, reserves, confirmedCount } = state;
  // The preview reads the roster alone, so typing a title or a rule does not work it out again.
  const roster = useMemo(
    () => createDefaultTournamentState({ players, reserves, confirmedCount }),
    [players, reserves, confirmedCount],
  );
  const form = useMemo(() => ({ ...setup, lbQualifiers }), [setup, lbQualifiers]);
  const rosterCount = (confirmedCount ?? null) === null ? null : rosterKeys(players).length;
  const count = typedHeadCount(typed) ?? rosterCount;
  const tooMany = count !== null && count > MAX_TYPED_COUNT && count !== rosterCount;
  const preview = useMemo(
    () => (count === null || tooMany ? null : previewSchedule(roster, form, count, previewRuntime())),
    [roster, form, count, tooMany],
  );
  return { form, rosterCount, count, tooMany, preview };
}
