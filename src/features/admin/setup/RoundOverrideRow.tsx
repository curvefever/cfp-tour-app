import { Button } from '../../../components/ui';
import type { MatchOverrideRow } from '../../../domain/tournament/round-match-formats';
import { MATCH_OVERRIDE_CONTROL_PREFIX } from '../../presence/presence.shared';
import { matchFromSelectValue, overrideSelectValue } from './format-fields';
import { MatchSelect } from './MatchSelect';

/** One round of the override list: its name and a format select whose first option is the stage's own format. */
export function RoundOverrideRow({
  index,
  row,
  stageFormat,
  onChange,
}: {
  index: number;
  row: MatchOverrideRow;
  /** The stage's format as the select words it, shown in the first option. */
  stageFormat: string;
  /** The row's new override token, '' to fall back to the stage's format. */
  onChange: (value: string) => void;
}) {
  const id = `${MATCH_OVERRIDE_CONTROL_PREFIX}${index}`;
  const { games = '', bestOf } = matchFromSelectValue(overrideSelectValue(row.token));
  return (
    <>
      <label className='pt-2 text-sm leading-5 font-bold wrap-break-word' htmlFor={id}>
        {row.shown ?? row.name}
      </label>
      <MatchSelect
        bestOf={bestOf}
        games={games}
        id={id}
        inheritLabel={`Stage format (${stageFormat})`}
        onChange={onChange}
      />
    </>
  );
}

/** An override whose round the schedule no longer has: it does nothing, and can be removed. */
export function OrphanOverrideRow({ row, onRemove }: { row: MatchOverrideRow; onRemove: () => void }) {
  return (
    <>
      <span className='pt-2 text-sm leading-5 font-bold wrap-break-word'>
        {row.name} · not in the schedule
      </span>
      <div className='flex items-center justify-between gap-2.5'>
        <span className='text-sm text-muted'>{row.token}</span>
        <Button
          aria-label={`Remove the override of ${row.name}`}
          size='sm'
          variant='secondary'
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </>
  );
}
