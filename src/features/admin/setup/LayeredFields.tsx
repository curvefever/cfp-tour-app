import { Input, Select } from '../../../components/ui';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { PresenceField } from '../../presence/PresenceField';
import { layeredPlaceholders } from './layered-summary';
import { useSetupChange } from './useSetupChange';

type NumberKey = 'layeredExpected' | 'layeredInBracket' | 'layeredRounds' | 'layeredTop';

/** What the numbers of a layered bracket ask of the organiser: each empty, with the number the app works out as its placeholder. */
export function LayeredFields({
  setup,
  registered,
  shown,
}: {
  setup: PersistedSetup;
  registered: number | null;
  shown: ReadonlySet<string>;
}) {
  const change = useSetupChange();
  if (!shown.has('layeredExpected')) return null;
  const placeholders = layeredPlaceholders(setup, registered);
  const number = (key: NumberKey, id: string, label: string, placeholder: string, help: string) => (
    <PresenceField htmlFor={id} label={label}>
      <Input
        id={id}
        type='number'
        min='1'
        placeholder={placeholder}
        value={setup[key]}
        onChange={(e) => change(key, e.target.value)}
      />
      <p className='text-xs text-muted'>{help}</p>
    </PresenceField>
  );
  return (
    <>
      {number(
        'layeredExpected',
        'cfg-layered-expected',
        'Expected to play (optional)',
        placeholders.play,
        'Empty, 9 in 10 of the registered. The bracket is sized from those who play.',
      )}
      {number(
        'layeredInBracket',
        'cfg-layered-in-bracket',
        'In the bracket (optional)',
        placeholders.inBracket,
        'How many of those who play are in the bracket; the table sends the rest out.',
      )}
      {number(
        'layeredRounds',
        'cfg-layered-rounds',
        'Bracket rounds (optional)',
        placeholders.bracketRounds,
        'The rounds after the table, Semi-Final B and the Final included.',
      )}
      <PresenceField htmlFor='cfg-layered-levels' label='Levels (optional)'>
        <Select
          id='cfg-layered-levels'
          value={setup.layeredLevels}
          onChange={(e) => change('layeredLevels', e.target.value)}
        >
          <option value=''>{`Automatic: ${placeholders.levels}`}</option>
          <option value='2'>2</option>
          <option value='3'>3</option>
        </Select>
      </PresenceField>
      {number(
        'layeredTop',
        'cfg-layered-top',
        'Top level (optional)',
        placeholders.topLevel,
        'Two equal rooms (12, 14 or 16 players), or one full room.',
      )}
    </>
  );
}
