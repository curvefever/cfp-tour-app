import { Button } from '../../components/ui';
import { useConfirmationClick } from '../rankings/useConfirmationClick';
import type { LikelyAbsentChip } from './likely-absent-line';

/** The element id the sticky bar's count scrolls to. */
export const LIKELY_ABSENT_LINE_ID = 'likely-absent-line';

/**
 * The organiser's box of names still counted as missing: a "?" chip per unit, which does what the Players tab's "?"
 * does. A box, not a warning: nothing here blocks Next Round, and a forgotten mark loses nothing.
 */
export function LikelyAbsentLine({ chips }: { chips: LikelyAbsentChip[] }) {
  const click = useConfirmationClick();
  if (!chips.length) return null;
  return (
    <div
      className='mb-4.5 rounded-xs bg-cfp-game-deep px-3.5 py-2.5 outline-2 outline-cfp-game-frame'
      id={LIKELY_ABSENT_LINE_ID}
    >
      <div className='text-base font-bold text-foreground'>Likely absent ({chips.length})</div>
      <div className='mt-1 text-[13px] text-cfp-text-soft'>
        Absent last time and not marked back, so the draw counts them as missing. Click a name when the player
        is back.
      </div>
      <div className='mt-2.5 flex flex-wrap gap-2'>
        {chips.map((chip) => (
          <Button
            aria-label={`Mark ${chip.label} back`}
            className='px-2.5 text-xs'
            key={chip.unit}
            onClick={() => click(chip.clickName)}
            size='sm'
            title={chip.title}
            variant='danger'
          >
            <span aria-hidden>?</span> {chip.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
