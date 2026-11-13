import {
  bestDestinationChoices,
  suggestedBest,
  type WaterfallDraft,
  type WaterfallDraftBest,
  type WaterfallDraftRound,
} from '../../../domain/tournament/waterfall-draft';
import { Select } from '../../../components/ui';
import { ordinal } from '../../../lib/ordinal';
import { fieldLabelClass } from './waterfall-format';

const NONE = '';

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

/**
 * "Best of a place": the best n of the k-th places of a round's rooms go to a later round, and the rest of that place
 * follow their rooms' own lines. Picking a place writes the best 1 of it to the first later round; the count and the
 * destination change after. Not offered on the Final, a ranking match or a round of one room. Without `onSetBest` (a
 * read-only editor) a round that has the line shows it, disabled.
 */
export function WaterfallBestField({
  draft,
  round,
  onSetBest,
}: {
  draft: WaterfallDraft;
  round: WaterfallDraftRound;
  onSetBest?: (best: WaterfallDraftBest | null) => void;
}) {
  const best = draft.best?.[round.label];
  const offered = !round.isFinal && !round.isRanking && round.roomCount >= 2;
  if (!offered || (!onSetBest && !best)) return null;

  const later = bestDestinationChoices(draft, round.label);
  const destinations = best && !later.includes(best.destination) ? [...later, best.destination] : later;
  const pickPlace = (value: string) => {
    if (value === NONE) return onSetBest?.(null);
    const suggested = suggestedBest(draft, round.label, Number(value));
    if (suggested) onSetBest?.(suggested);
  };
  const change = (patch: Partial<WaterfallDraftBest>) => best && onSetBest?.({ ...best, ...patch });

  return (
    <div className='mt-3'>
      <span
        className={fieldLabelClass}
        title='The best n of the k-th places of the rooms go to a later round; the rest of that place follow their rooms’ own lines.'
      >
        Best of a place
      </span>
      <div className='mt-1 flex flex-wrap items-center gap-2 text-sm'>
        <Select
          aria-label='Best of a place: place'
          className='w-24'
          disabled={!onSetBest}
          onChange={(event) => pickPlace(event.target.value)}
          value={best ? String(best.place) : NONE}
        >
          <option value={NONE}>None</option>
          {range(round.roomSize).map((place) => (
            <option key={place} value={place}>
              {ordinal(place)}
            </option>
          ))}
        </Select>
        {best ? (
          <>
            <span className='text-muted'>best</span>
            <Select
              aria-label='Best of a place: how many'
              className='w-16'
              disabled={!onSetBest}
              onChange={(event) => change({ count: Number(event.target.value) })}
              value={String(best.count)}
            >
              {range(round.roomCount - 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
            <span className='flex items-center gap-2'>
              <span className='text-muted'>→</span>
              <Select
                aria-label='Best of a place: goes to'
                className='w-32'
                disabled={!onSetBest}
                onChange={(event) => change({ destination: event.target.value })}
                value={best.destination}
              >
                {destinations.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </Select>
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
