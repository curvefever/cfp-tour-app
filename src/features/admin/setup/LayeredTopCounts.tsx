import { Button, Input, Select } from '../../../components/ui';
import { withTopCount, type TopCountLine } from '../../../domain/tournament/layered-form';
import type { SemiOthersRow, TopCountRow } from './layered-summary';
import { useSetupUpdate } from './useSetupChange';

/** What the first semi-final's other half do, as the select words it. */
const SEMI_OTHERS_WORDS = {
  'play-on': 'Play on in the level below',
  wait: 'Wait for Semi-Final B',
  'last-semi': 'Go to Semi-Final B (it is in the last round)',
} as const;

/** A typed line for a round or level the plan does not have: shown, never dropped silently, and cleared by the organiser. */
function NoLongerApplies({ line, onClear }: { line: TopCountLine; onClear: (name: string) => void }) {
  return (
    <li className='flex flex-wrap items-center gap-2 text-sm' data-no-longer-applies={line.name}>
      <span>
        <b>{line.name}</b> the top {line.top}
      </span>
      <span className='text-warning'>no longer applies</span>
      <Button onClick={() => onClear(line.name)}>Clear</Button>
    </li>
  );
}

/** The top places of each room per round and level, each empty with the app's number as placeholder, and the other half of Semi-Final A. */
export function LayeredTopCounts({
  rows,
  noLongerApply,
  semiOthers,
}: {
  rows: TopCountRow[];
  noLongerApply: TopCountLine[];
  semiOthers: SemiOthersRow;
}) {
  const updateSetup = useSetupUpdate();
  const setTop = (name: string, top: string) =>
    updateSetup((current) => ({
      ...current,
      layeredTopCounts: withTopCount(current.layeredTopCounts, name, top),
    }));
  return (
    <div className='flex flex-col gap-2' id='layered-top-counts'>
      <b className='text-sm'>Top places of each room</b>
      <p className='text-xs text-muted'>
        Empty, the app works the number out. A number you type is kept, and the app plans the rest around it.
      </p>
      <ul className='flex flex-col gap-1.5'>
        {rows.map((row) => (
          <li className='flex flex-wrap items-center gap-2 text-sm' key={row.name}>
            <label className='min-w-40' htmlFor={`layered-top-${row.name}`}>
              {row.name}
            </label>
            <Input
              aria-label={`The top places of each room in ${row.name}`}
              className='!h-8 !w-20'
              id={`layered-top-${row.name}`}
              min='1'
              placeholder={`${row.top}`}
              type='number'
              value={row.typed}
              onChange={(event) => setTop(row.name, event.target.value)}
            />
            <span className='text-xs text-muted'>{row.typed ? 'yours' : "the app's"}</span>
          </li>
        ))}
        {noLongerApply.map((line) => (
          <NoLongerApplies key={line.name} line={line} onClear={(name) => setTop(name, '')} />
        ))}
      </ul>
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <label className='min-w-40' htmlFor='layered-semi-others'>
          The other half of Semi-Final A
        </label>
        <Select
          className='!h-8 !w-auto'
          id='layered-semi-others'
          value={semiOthers.typed}
          onChange={(event) =>
            updateSetup((current) => ({
              ...current,
              layeredSemiOthers: event.target.value as '' | 'play-on' | 'wait',
            }))
          }
        >
          <option value=''>{`Automatic: ${SEMI_OTHERS_WORDS[semiOthers.value]}`}</option>
          <option value='play-on'>{SEMI_OTHERS_WORDS['play-on']}</option>
          <option value='wait'>{SEMI_OTHERS_WORDS.wait}</option>
        </Select>
        <span className='text-xs text-muted'>{semiOthers.typed ? 'yours' : "the app's"}</span>
      </div>
    </div>
  );
}

/** While the bracket is refused: what was typed for the top places, so that a number can be cleared and the plan tried again. */
export function TypedTopCounts({ lines }: { lines: TopCountLine[] }) {
  const updateSetup = useSetupUpdate();
  if (lines.length === 0) return null;
  const clear = (name: string) =>
    updateSetup((current) => ({
      ...current,
      layeredTopCounts: withTopCount(current.layeredTopCounts, name, ''),
    }));
  return (
    <ul className='mt-3 flex flex-col gap-1.5' id='layered-typed-top-counts'>
      {lines.map((line) => (
        <li className='flex flex-wrap items-center gap-2 text-sm' key={line.name}>
          <span>
            <b>{line.name}</b> the top {line.top}, yours
          </span>
          <Button onClick={() => clear(line.name)}>Clear</Button>
        </li>
      ))}
    </ul>
  );
}
