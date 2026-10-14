import { Button } from '../../components/ui';
import { useStatusAction } from '../admin/useStatusAction';
import { FINISH_REMINDER } from '../tournaments/admin-actions';

/** The "Final complete" reminder with the Finish button (admins, until the tournament is finished). */
export function FinishReminder() {
  const { working, error, run } = useStatusAction();
  return (
    <div className='flex flex-col gap-2 rounded-xs bg-success/10 px-4 py-3 outline-2 outline-success/55'>
      <div className='flex flex-wrap items-center gap-x-4.5 gap-y-3' role='status'>
        <svg aria-hidden='true' height='22' viewBox='0 0 16 16' width='22'>
          <circle className='fill-cfp-green' cx='8' cy='8' r='8' />
          <path
            className='stroke-cfp-brand-ink'
            d='M4.5 8.2 L7 10.5 L11.5 5.5'
            fill='none'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
          />
        </svg>
        <div className='min-w-75 flex-1 text-base font-bold'>{FINISH_REMINDER}</div>
        <div className='text-[13px] text-muted'>Only admins see this</div>
        <Button disabled={working !== null} onClick={() => void run('finish')} variant='primary'>
          {working === 'finish' ? 'Working…' : 'Finish tournament'}
        </Button>
      </div>
      {error ? <div className='text-sm text-cfp-danger-text'>{error}</div> : null}
    </div>
  );
}
