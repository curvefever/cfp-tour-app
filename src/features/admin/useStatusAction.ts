import { useState } from 'react';
import type { StatusButton } from '../tournaments/admin-actions';
import { useTournamentApp } from '../tournament/TournamentProvider';

/**
 * Runs a status change of the loaded tournament (publish, finish, reopen, ...) and keeps what the buttons need:
 * which action is working and the refusal message of the last one. Shared by the Admin status panel and the
 * Bracket's "Final complete" banner, so both finish a tournament the same way.
 */
export function useStatusAction() {
  const app = useTournamentApp();
  const [working, setWorking] = useState<StatusButton | null>(null);
  const [error, setError] = useState('');

  /** Resolves when the change is done (or refused: the message is then in `error`). */
  async function run(action: StatusButton): Promise<void> {
    setError('');
    setWorking(action);
    const message = await app.changeStatus(action);
    setWorking(null);
    if (message) setError(message);
  }

  return { working, error, run };
}
