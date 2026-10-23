import { useState } from 'react';
import { staleDrawRefusal } from '../../../domain/tournament/pre-start-roster';
import { Alert, Button, cn } from '../../../components/ui';
import { transitionRefusal } from '../../tournaments/tournament-lifecycle';
import { useTournamentApp } from '../../tournament/TournamentProvider';

/**
 * The Confirm & Start button with what stands in its way (a refusal, an error from the server). Shown while a
 * generated schedule has not started. `pinned` is the phone's copy, at the end of the Setup page and stuck to the
 * bottom of the screen; the other copy sits under the schedule preview and is hidden on a phone.
 */
export function ConfirmStartBar({ pinned = false }: { pinned?: boolean }) {
  const { state, startTournamentNow } = useTournamentApp();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  async function confirmAndStart() {
    setStartError('');
    setStarting(true);
    const message = await startTournamentNow();
    setStarting(false);
    if (message) setStartError(message);
  }

  const startRefusal =
    transitionRefusal('start', {
      status: state.lifecycle?.status ?? 'draft',
      started: false,
      testRun: state.lifecycle?.testRun ?? false,
      title: state.title,
      scheduledAt: state.info?.scheduledAt ?? null,
    }) ?? staleDrawRefusal(state);

  if (!state.rounds.length || state.started) return null;
  return (
    <div
      className={cn(
        'flex flex-col gap-3.5',
        pinned
          ? 'sticky bottom-0 z-30 -mx-3 w-[calc(100%+24px)] basis-full gap-2 border-t border-surface-hover bg-background px-3 pt-2 pb-1.5 min-[701px]:hidden'
          : 'max-[700px]:hidden',
      )}
      data-confirm-start={pinned ? 'pinned' : 'inline'}
    >
      {startRefusal ? <p className='text-xs text-muted'>{startRefusal}</p> : null}
      {startError ? <Alert tone='danger'>{startError}</Alert> : null}
      <Button
        className='h-12 w-full text-base font-extrabold'
        variant='primary'
        disabled={Boolean(startRefusal) || starting}
        onClick={() => void confirmAndStart()}
      >
        {starting ? 'Starting…' : 'Confirm & Start'}
      </Button>
    </div>
  );
}
