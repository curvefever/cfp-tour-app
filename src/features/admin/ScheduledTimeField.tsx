import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { Field, Input } from '../../components/ui';
import { fromDateTimeLocalValue, timeZoneLabel, toDateTimeLocalValue } from '../tournaments/scheduled-time';
import { useTournamentApp } from '../tournament/TournamentProvider';

/** The scheduled date and time of the loaded tournament, typed in the time zone of this browser. */
export function ScheduledTimeField({ id }: { id: string }) {
  const { state, updateState } = useTournamentApp();
  const scheduledAt = state.info?.scheduledAt ?? null;
  const zone = timeZoneLabel(scheduledAt ?? Date.now());
  return (
    <Field label={`Scheduled date and time (your time, ${zone})`} htmlFor={id}>
      <Input
        id={id}
        type='datetime-local'
        value={toDateTimeLocalValue(scheduledAt)}
        onChange={(event) =>
          updateState((current) => ({
            ...current,
            info: {
              ...(current.info ?? createDefaultInfo()),
              scheduledAt: fromDateTimeLocalValue(event.target.value),
            },
          }))
        }
      />
    </Field>
  );
}
