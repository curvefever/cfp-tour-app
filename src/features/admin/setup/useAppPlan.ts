import { useMemo } from 'react';
import type { GenerationForm } from '../../../domain/tournament/generation-plan-types';
import { typedNonCounting } from '../../../domain/tournament/pooling-rounds';
import { rosterKeys } from '../../../domain/tournament/roster';
import {
  previewRuntime,
  previewSchedule,
  type SchedulePreview,
} from '../../../domain/tournament/schedule-preview';
import { createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { TournamentState } from '../../../domain/tournament/types';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import type { AppValue } from './AppValueInput';
import { appValueFrom, appValueOf, type AppValueField } from './plan-decisions';

/** The most units a typed head count is worked out for: a layered bracket's plan takes seconds at a few hundred. */
export const MAX_TYPED_COUNT = 200;

/** The app's value for a Setup field, for the plan's head count. */
export type AppValueReader = (field: AppValueField) => AppValue;

/** The plan of the Setup form for a head count: what the panel and the override fields both show. */
export interface AppPlan {
  form: GenerationForm;
  rosterCount: number | null;
  /** The typed count, else the roster's; null with neither. */
  count: number | null;
  tooMany: boolean;
  /** Null when there is no count to plan for. */
  preview: SchedulePreview | null;
  appValue: AppValueReader;
}

/** A typed head count: a positive whole number; anything else, an empty field included, is none. */
function typedHeadCount(typed: string | null): number | null {
  return typed !== null && /^[1-9]\d*$/.test(typed) ? Number(typed) : null;
}

function isTypedField(form: GenerationForm, field: AppValueField): boolean {
  // An older setup's stored '0' uncounted rounds is nobody's typing (`poolingRoundsOf`).
  if (field === 'nonCountingRounds') return typedNonCounting(form) !== undefined;
  return form[field].trim() !== '';
}

/**
 * Reads each field's value once. An empty field's is the plan's own number; only a typed field takes a plan of its
 * own, with that field left empty.
 */
function appValueReader(
  form: GenerationForm,
  roster: TournamentState,
  count: number | null,
  preview: SchedulePreview | null,
): AppValueReader {
  const read = (field: AppValueField): AppValue => {
    const typed = isTypedField(form, field);
    if (count === null || preview === null) return { value: null, typed };
    if (typed) return { value: appValueOf(field, roster, form, count), typed };
    return { value: preview.status === 'generated' ? appValueFrom(field, preview) : null, typed };
  };
  const known = new Map<AppValueField, AppValue>();
  return (field) => {
    const value = known.get(field) ?? read(field);
    known.set(field, value);
    return value;
  };
}

/**
 * The app's plan for a head count: the typed one, else the loaded roster's. `typed` is the head count field as this tab
 * has it (null while untouched); it is stored nowhere. The plan follows the Setup form, not the generated schedule.
 */
export function useAppPlan(typed: string | null, lbQualifiers: string): AppPlan {
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
  const appValue = useMemo(
    () => appValueReader(form, roster, count, preview),
    [form, roster, count, preview],
  );
  return { form, rosterCount, count, tooMany, preview, appValue };
}
