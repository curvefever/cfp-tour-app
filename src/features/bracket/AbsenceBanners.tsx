import { answerAbsence } from '../../domain/tournament/absences';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, ButtonRow, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { absenceBannerRows } from './absence-banners';

/** The bar for each room with a score of 0 not yet answered as absent or played, beside the tie banners. */
export function AbsenceBanners({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  return absenceBannerRows(state).map((row) => (
    <div
      className={cn(
        'mb-4.5 flex flex-wrap items-center justify-between gap-2.5 rounded-xs px-4 py-3 outline-2',
        row.tone === 'warning' ? 'bg-warning/10 outline-warning/55' : 'bg-danger/12 outline-danger/55',
      )}
      key={row.key}
    >
      <div>
        <div
          className={cn(
            'text-base font-bold',
            row.tone === 'warning' ? 'text-cfp-orange-text' : 'text-cfp-danger-text',
          )}
        >
          {row.heading}
        </div>
        <div className='mt-1 text-[13px] text-cfp-text-soft'>{row.detail}</div>
      </div>
      <ButtonRow className='mt-0'>
        {row.buttons.map((button) => (
          <Button
            size='sm'
            variant='warning'
            key={`${button.answer}-${button.keys.join('+')}`}
            onClick={() => app.updateState((current) => answerAbsence(current, button.keys, button.answer))}
          >
            {button.label}
          </Button>
        ))}
      </ButtonRow>
    </div>
  ));
}
