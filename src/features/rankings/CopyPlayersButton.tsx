import { useState } from 'react';
import { playersWhoPlayed } from '../../domain/tournament/players-who-played';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, Textarea } from '../../components/ui';

const CONFIRMATION_MS = 3_000;

/**
 * Copies the names of the people who played, one per line, for the organiser to paste elsewhere. Where the clipboard is
 * refused, the list shows in a read-only box to copy by hand. A 44 px icon button on a phone.
 */
export function CopyPlayersButton({ state }: { state: TournamentState }) {
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [handCopy, setHandCopy] = useState<string | null>(null);

  async function copy() {
    const names = playersWhoPlayed(state);
    const text = names.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setHandCopy(null);
      setConfirmation(`Copied ${names.length} ${names.length === 1 ? 'player' : 'players'}`);
      window.setTimeout(() => setConfirmation(null), CONFIRMATION_MS);
    } catch {
      setConfirmation(null);
      setHandCopy(text);
    }
  }

  return (
    <>
      <Button
        className='gap-2 max-[700px]:size-11 max-[700px]:justify-center max-[700px]:px-0'
        onClick={() => void copy()}
      >
        <svg aria-hidden='true' height='16' viewBox='0 0 16 16' width='16'>
          <rect
            fill='none'
            height='9'
            rx='1.5'
            stroke='currentColor'
            strokeWidth='1.8'
            width='8'
            x='5.5'
            y='5.5'
          />
          <path
            d='M10.5 3.5 V3 A1.5 1.5 0 0 0 9 1.5 H3.5 A1.5 1.5 0 0 0 2 3 V9 A1.5 1.5 0 0 0 3.5 10.5 H4'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeWidth='1.8'
          />
        </svg>
        <span className='max-[700px]:sr-only'>Copy players</span>
      </Button>
      <span aria-live='polite' className='text-sm font-bold text-muted' role='status'>
        {confirmation}
      </span>
      {handCopy === null ? null : (
        <Textarea
          aria-label='Players to copy'
          className='basis-full'
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          rows={Math.min(handCopy.split('\n').length, 12)}
          value={handCopy}
        />
      )}
    </>
  );
}
