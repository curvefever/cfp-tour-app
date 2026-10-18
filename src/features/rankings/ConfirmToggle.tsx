import type { ReactNode } from 'react';
import type { TeamConfirmation } from '../../domain/tournament/confirmations';
import { isConfirmed, setConfirmed } from '../../domain/tournament/confirmations';
import { Button, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { teamConfirmationText } from './confirmation-view';

const SIZES = {
  row: 'w-8.5 px-0',
  chip: 'size-6 min-h-0 p-0 text-xs',
} as const;

/** The first control of a player row: ✓ on green when confirmed, ? on red when not, so the state is not only colour. */
export function ConfirmToggle({
  confirmed,
  name,
  size = 'row',
}: {
  confirmed: boolean;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const app = useTournamentApp();
  return (
    <Button
      aria-label={`Confirmed: ${name}`}
      aria-pressed={confirmed}
      className={cn(SIZES[size], confirmed && 'bg-cfp-green-dim text-cfp-green-text')}
      onClick={() => app.updateState((current) => setConfirmed(current, name, !isConfirmed(current, name)))}
      size='sm'
      title={confirmed ? 'Confirmed — click to undo' : 'Not confirmed yet — click to confirm'}
      variant={confirmed ? 'secondary' : 'danger'}
    >
      {confirmed ? '✓' : '?'}
    </Button>
  );
}

const DOT_COLOURS = { all: 'bg-success', some: 'bg-warning', none: 'bg-danger' } as const;

/** A team's name behind its confirmation dot (green, orange or red), with "1/3" after the name while partial. */
export function TeamConfirmationLabel({
  children,
  confirmation,
}: {
  children: ReactNode;
  confirmation: TeamConfirmation;
}) {
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5'>
      <span
        aria-label={teamConfirmationText(confirmation)}
        className={cn('inline-block size-2.5 shrink-0 rounded-full', DOT_COLOURS[confirmation.level])}
        role='img'
      />
      {children}
      {confirmation.level === 'some' ? (
        <small className='font-normal text-muted'>
          {confirmation.confirmed}/{confirmation.total}
        </small>
      ) : null}
    </span>
  );
}
