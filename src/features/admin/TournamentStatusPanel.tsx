import { useState } from 'react';
import { computeRankings } from '../../domain/tournament/rankings';
import { Alert, Badge, Button, ButtonRow, Modal, ModalActions, Panel, PanelTitle } from '../../components/ui';
import { adminActions, FINISH_REMINDER, stateSubject, type StatusButton } from '../tournaments/admin-actions';
import { PHASE_LABELS, PHASE_TONES } from '../tournaments/phase-display';
import { tournamentPhase } from '../tournaments/tournament-lifecycle';
import { useTournamentApp } from '../tournament/TournamentProvider';

const BUTTON_LABELS: Record<StatusButton, string> = {
  publish: 'Publish',
  unpublish: 'Unpublish',
  finish: 'Finish tournament',
  reopen: 'Reopen',
  delete: 'Delete tournament',
};

const BUTTON_VARIANTS: Partial<Record<StatusButton, 'success' | 'danger'>> = {
  publish: 'success',
  finish: 'success',
  delete: 'danger',
};

/** The status of the loaded tournament, the buttons its status allows and the reminder to finish it. */
export function TournamentStatusPanel() {
  const app = useTournamentApp();
  const { state } = app;
  const [working, setWorking] = useState<StatusButton | null>(null);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const subject = stateSubject(state);
  // A tournament stored before statuses existed has no status to show.
  if (!subject) return null;
  const { actions, finishReminder } = adminActions(subject, computeRankings(state)?.finalComplete ?? false);
  const phase = tournamentPhase(subject, Date.now());

  async function run(action: StatusButton) {
    setError('');
    setWorking(action);
    const message = await app.changeStatus(action);
    setWorking(null);
    setConfirmingDelete(false);
    if (message) setError(message);
  }

  return (
    <Panel>
      <PanelTitle>Status</PanelTitle>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <Badge tone={PHASE_TONES[phase]}>{PHASE_LABELS[phase]}</Badge>
        {subject.testRun ? <Badge>Test run</Badge> : null}
      </div>
      {finishReminder ? (
        <Alert tone='warning' className='mb-3'>
          {FINISH_REMINDER}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone='danger' className='mb-3'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow>
        {actions.map(({ action, refusal }) => (
          <Button
            key={action}
            variant={BUTTON_VARIANTS[action]}
            disabled={Boolean(refusal) || working !== null}
            onClick={() => (action === 'delete' ? setConfirmingDelete(true) : void run(action))}
          >
            {working === action ? 'Working…' : BUTTON_LABELS[action]}
          </Button>
        ))}
      </ButtonRow>
      {actions.map(({ action, refusal }) =>
        refusal ? (
          <p key={action} className='mt-2 text-xs text-muted'>
            {refusal}
          </p>
        ) : null,
      )}
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
    </Panel>
  );
}
