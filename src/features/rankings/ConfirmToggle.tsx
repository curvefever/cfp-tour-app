import type { ReactNode } from 'react';
import type { ConfirmationSource, TeamConfirmation } from '../../domain/tournament/confirmations';
import { isManuallyConfirmed, setConfirmed } from '../../domain/tournament/confirmations';
import { Button, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { teamConfirmationText } from './confirmation-view';
import { CHIP_BUTTON, ICON_BUTTON } from './tool-buttons';

const SIZES = {
  row: ICON_BUTTON,
  chip: `${CHIP_BUTTON} text-xs`,
} as const;

/** The first control of a player row: ✓ on green when confirmed, ? on red when not, so the state is not only colour. A score confirms the player and locks the toggle. */
export function ConfirmToggle({
  name,
  size = 'row',
  source,
}: {
  name: string;
  size?: keyof typeof SIZES;
  source: ConfirmationSource;
}) {
  const app = useTournamentApp();
  const confirmed = source !== null;
  const title = {
    score: 'Confirmed — has a score',
    manual: 'Confirmed — click to undo',
    none: 'Not confirmed yet — click to confirm',
  }[source ?? 'none'];
  return (
    <Button
      aria-label={`Confirmed: ${name}`}
      aria-pressed={confirmed}
      className={cn(SIZES[size], confirmed && 'bg-cfp-green-dim text-cfp-green-text disabled:opacity-70')}
      disabled={source === 'score'}
      onClick={() =>
        app.updateState((current) => setConfirmed(current, name, !isManuallyConfirmed(current, name)))
      }
      size='sm'
      title={title}
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
