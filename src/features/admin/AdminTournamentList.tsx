import { useState } from 'react';
import { Alert, Badge, Button, ButtonRow, Panel, PanelTitle } from '../../components/ui';
import { getTourEnvironment } from '../sync/firebase-paths';
import { adminListEntries } from '../tournaments/tournament-index';
import { tournamentPhase } from '../tournaments/tournament-lifecycle';
import { PHASE_LABELS, PHASE_TONES } from '../tournaments/phase-display';
import type { TournamentSummary } from '../tournaments/tournament-summary';
import { useTournamentIndex } from '../tournaments/useTournamentIndex';
import { useTournamentApp } from '../tournament/TournamentProvider';

function TournamentRow({ summary, onOpen }: { summary: TournamentSummary; onOpen(): void }) {
  const phase = tournamentPhase(summary, Date.now());
  return (
    <li className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-hover px-3 py-2'>
      <div className='min-w-0'>
        <div className='truncate font-semibold'>{summary.title || 'Unnamed Tournament'}</div>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted'>
          <Badge tone={PHASE_TONES[phase]}>{PHASE_LABELS[phase]}</Badge>
          {summary.testRun ? <Badge>Test run</Badge> : null}
          <span>
            {summary.scheduledAt === null ? 'No date yet' : new Date(summary.scheduledAt).toLocaleString()}
          </span>
        </div>
      </div>
      <Button size='sm' onClick={onOpen}>
        Open
      </Button>
    </li>
  );
}

/** The Admin tab while no tournament is loaded: every draft, published and ongoing tournament, and a way to start a new one. */
export function AdminTournamentList() {
  const app = useTournamentApp();
  const index = useTournamentIndex();
  const [testRun, setTestRun] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const onProduction = getTourEnvironment(window.location.hostname) === 'prod';
  const entries = adminListEntries(index.summaries);

  async function createNew() {
    setError('');
    setCreating(true);
    const message = await app.createTournamentRecord(testRun);
    setCreating(false);
    if (message) setError(message);
  }

  return (
    <Panel>
      <PanelTitle>Tournaments</PanelTitle>
      <ButtonRow>
        <Button variant='success' disabled={creating} onClick={() => void createNew()}>
          {creating ? 'Creating…' : '＋ New tournament'}
        </Button>
        {onProduction ? (
          <label className='flex items-center gap-1.5 text-xs text-muted'>
            <input type='checkbox' checked={testRun} onChange={(event) => setTestRun(event.target.checked)} />
            Test run
          </label>
        ) : null}
      </ButtonRow>
      {error ? <Alert tone='danger'>{error}</Alert> : null}
      {index.status === 'loading' ? <p className='text-sm text-muted'>Loading the tournaments…</p> : null}
      {index.status === 'unavailable' || index.status === 'error' ? (
        <Alert tone='danger'>The tournament list is unavailable right now.</Alert>
      ) : null}
      {index.status === 'ready' && !entries.length ? (
        <p className='text-sm text-muted'>No tournament in preparation yet.</p>
      ) : null}
      <ul className='mt-3 flex flex-col gap-2'>
        {entries.map((summary) => (
          <TournamentRow
            key={summary.id}
            summary={summary}
            onOpen={() => void app.loadTournament(summary.id)}
          />
        ))}
      </ul>
    </Panel>
  );
}
