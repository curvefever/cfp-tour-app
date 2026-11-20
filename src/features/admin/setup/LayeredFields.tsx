import { Input, Select } from '../../../components/ui';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { PresenceField } from '../../presence/PresenceField';
import { layeredPlaceholders } from './layered-summary';

type NumberKey = 'layeredExpected' | 'layeredInBracket' | 'layeredRounds' | 'layeredTop';
export type LayeredFieldKey = NumberKey | 'layeredLevels';

/** The settings the five typed fields read: the form of Setup, or the stored settings of a running tournament. */
export type LayeredFieldsForm = Parameters<typeof layeredPlaceholders>[0] &
  Pick<PersistedSetup, LayeredFieldKey>;

/**
 * What the numbers of a layered bracket ask of the organiser: each empty, with the number the app works out as its
 * placeholder. Setup shows all five; the running Admin's card leaves out "Expected to play" (it is the number who play
 * now) and gives its own `idPrefix`.
 */
export function LayeredFields({
  form,
  registered,
  onChange,
  hide = [],
  idPrefix = 'cfg',
}: {
  form: LayeredFieldsForm;
  registered: number | null;
  onChange: (key: LayeredFieldKey, value: string) => void;
  hide?: LayeredFieldKey[];
  idPrefix?: string;
}) {
  const placeholders = layeredPlaceholders(form, registered);
  const number = (key: NumberKey, id: string, label: string, placeholder: string, help: string) =>
    hide.includes(key) ? null : (
      <PresenceField htmlFor={`${idPrefix}-${id}`} label={label}>
        <Input
          id={`${idPrefix}-${id}`}
          type='number'
          min='1'
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => onChange(key, e.target.value)}
        />
        <p className='text-xs text-muted'>{help}</p>
      </PresenceField>
    );
  return (
    <>
      {number(
        'layeredExpected',
        'layered-expected',
        'Expected to play (optional)',
        placeholders.play,
        'Empty, 9 in 10 of the registered. The bracket is sized from those who play.',
      )}
      {number(
        'layeredInBracket',
        'layered-in-bracket',
        'In the bracket (optional)',
        placeholders.inBracket,
        'How many of those who play are in the bracket; the table sends the rest out.',
      )}
      {number(
        'layeredRounds',
        'layered-rounds',
        'Bracket rounds (optional)',
        placeholders.bracketRounds,
        'The rounds after the table, Semi-Final B and the Final included.',
      )}
      <PresenceField htmlFor={`${idPrefix}-layered-levels`} label='Levels (optional)'>
        <Select
          id={`${idPrefix}-layered-levels`}
          value={form.layeredLevels}
          onChange={(e) => onChange('layeredLevels', e.target.value)}
        >
          <option value=''>{`Automatic: ${placeholders.levels}`}</option>
          <option value='2'>2</option>
          <option value='3'>3</option>
        </Select>
      </PresenceField>
      {number(
        'layeredTop',
        'layered-top',
        'Top level (optional)',
        placeholders.topLevel,
        'Two equal rooms (12, 14 or 16 players), or one full room.',
      )}
    </>
  );
}
