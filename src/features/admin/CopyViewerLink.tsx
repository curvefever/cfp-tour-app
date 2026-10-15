import { useState } from 'react';
import { Button } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

/** Copies the link viewers open this tournament with; where the clipboard is refused, shows it to copy by hand. */
export function CopyViewerLink() {
  const { state } = useTournamentApp();
  const [copied, setCopied] = useState(false);
  if (!state.tournamentId) return null;
  const url = `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(state.tournamentId)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  return (
    <Button className='min-w-40' onClick={() => void copy()} variant='secondary'>
      {copied ? 'Copied' : 'Copy viewer link'}
    </Button>
  );
}
