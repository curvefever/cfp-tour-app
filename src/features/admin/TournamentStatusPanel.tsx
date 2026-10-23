import { useState } from 'react';
import { computeRankings } from '../../domain/tournament/rankings';
import { Alert, Badge, Button, Modal, ModalActions } from '../../components/ui';
import {
  adminActions,
  stateSubject,
  statusExplanation,
  type StatusButton,
} from '../tournaments/admin-actions';
import { ADMIN_STATUS_PILLS } from '../tournaments/phase-display';
import { scheduledParts } from '../tournaments/tournament-info';
import { tournamentPhase } from '../tournaments/tournament-lifecycle';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useStatusAction } from './useStatusAction';

const BUTTON_LABELS: Record<StatusButton, string> = {
  publish: 'Publish',
  unpublish: 'Unpublish',
  finish: 'Finish tournament',
  reopen: 'Reopen',
  delete: 'Delete tournament',
};

/** Publish and Finish are the step the tournament is waiting for; Publish reads as plain while it is refused. */
function buttonVariant(action: StatusButton, refused: boolean): 'primary' | 'secondary' | 'danger' {
  if (action === 'delete') return 'danger';
  if (action === 'finish') return 'primary';
  return action === 'publish' && !refused ? 'primary' : 'secondary';
}

/** The status of the loaded tournament: its pill, what it means, and the buttons its status allows. */
export function TournamentStatusPanel() {
  const app = useTournamentApp();
  const { state } = app;
  const { working, error, run: runStatusAction } = useStatusAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const subject = stateSubject(state);
  // A tournament stored before statuses existed has no status to show.
  if (!subject) return null;
  const finalComplete = computeRankings(state)?.finalComplete ?? false;
  const { actions } = adminActions(subject, finalComplete);
  const nowMs = Date.now();
  const pill = ADMIN_STATUS_PILLS[tournamentPhase(subject, nowMs)];
  const explanation = statusExplanation(subject, {
    finalComplete,
    startedText:
      subject.scheduledAt === null
        ? null
        : scheduledParts(subject.scheduledAt, nowMs, { relative: false }).date,
  });

  async function run(action: StatusButton) {
    await runStatusAction(action);
    setConfirmingDelete(false);
  }

  return (
    <section
      aria-label='Tournament status'
      className='flex flex-col gap-3 rounded-md border border-surface-hover bg-surface px-4.5 py-3.5'
    >
      <div className='flex flex-wrap items-center gap-x-4.5 gap-y-3'>
        <div className='flex items-center gap-2'>
          <Badge className='px-2.25 py-1 text-xs' tone={pill.tone}>
            {pill.label}
          </Badge>
          {subject.testRun ? <Badge className='px-2.25 py-1 text-xs text-muted'>Test run</Badge> : null}
        </div>
        <p
          className={
            explanation.reminder
              ? 'flex-[1_1_300px] text-[15px] font-bold text-cfp-green-text'
              : 'flex-[1_1_260px] text-sm text-cfp-text-soft'
          }
        >
          {explanation.text}
          {explanation.hint ? <span className='text-cfp-orange-text'> {explanation.hint}</span> : null}
        </p>
        {actions.map(({ action, refusal }) => (
          <Button
            className='max-[700px]:w-full'
            key={action}
            variant={buttonVariant(action, Boolean(refusal))}
            disabled={Boolean(refusal) || working !== null}
            onClick={() => (action === 'delete' ? setConfirmingDelete(true) : void run(action))}
          >
            {working === action ? 'Working…' : BUTTON_LABELS[action]}
          </Button>
        ))}
      </div>
      {error ? <Alert tone='danger'>{error}</Alert> : null}
      {confirmingDelete ? (
        <Modal titleId='delete-tournament-title' title='Delete tournament'>
          <p>
            Delete &ldquo;{state.title.trim() || 'Unnamed Tournament'}&rdquo; for good? Its scores, Setup and
            screenshots are removed and cannot be brought back.
          </p>
          <ModalActions>
            <Button variant='danger' disabled={working !== null} onClick={() => void run('delete')}>
              Delete
            </Button>
            <Button disabled={working !== null} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </ModalActions>
        </Modal>
      ) : null}
    </section>
  );
}
