import { useState } from 'react';
import { Alert, Badge, Button, PageHeading, SectionPanel } from '../../components/ui';
import { getTourEnvironment } from '../sync/firebase-paths';
import { scheduledParts } from '../tournaments/tournament-info';
import { adminListGroups } from '../tournaments/tournament-index';
import { tournamentPhase, type TournamentPhase } from '../tournaments/tournament-lifecycle';
import type { TournamentSummary } from '../tournaments/tournament-summary';
import { useTournamentIndex } from '../tournaments/useTournamentIndex';
import { useTournamentApp } from '../tournament/TournamentProvider';

type PillTone = 'now' | 'warning' | 'success' | 'neutral';

/** What a row's status pill says, by phase (a published tournament that has not started reads "Published"). */
const STATUS_PILLS: Partial<Record<TournamentPhase, { label: string; tone: PillTone }>> = {
  ongoing: { label: 'Ongoing', tone: 'now' },
  'starting-soon': { label: 'Starting soon', tone: 'warning' },
  upcoming: { label: 'Published', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
};

function TournamentRow({ summary, onOpen }: { summary: TournamentSummary; onOpen(): void }) {
  const pill = STATUS_PILLS[tournamentPhase(summary, Date.now())];
  return (
    <li>
      <button
        className='flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 border-b border-cfp-mid-row-line px-4.5 py-3.5 text-left last:border-b-0 hover:bg-surface-low focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
        onClick={onOpen}
      >
        <span className='w-30 shrink-0'>
          {pill ? (
            <Badge className='px-2 py-1' tone={pill.tone}>
              {pill.label}
            </Badge>
          ) : null}
        </span>
        <span className='flex min-w-0 flex-[1_1_260px] items-center gap-2'>
          <span className='truncate text-base font-bold'>{summary.title.trim() || 'Unnamed Tournament'}</span>
          {summary.testRun ? <Badge className='text-muted'>Test run</Badge> : null}
        </span>
        <span className='w-50 shrink-0 text-sm text-cfp-text-soft'>
          {summary.scheduledAt === null
            ? 'No date yet'
            : scheduledParts(summary.scheduledAt, Date.now(), { relative: false }).date}
        </span>
        <svg aria-hidden='true' height='16' viewBox='0 0 16 16' width='16'>
          <path
            d='M6 3 L11 8 L6 13'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
          />
        </svg>
      </button>
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
  const groups = adminListGroups(index.summaries, Date.now());

  async function createNew() {
    setError('');
    setCreating(true);
    const message = await app.createTournamentRecord(testRun);
    setCreating(false);
    if (message) setError(message);
  }

  return (
    <div className='mx-auto flex max-w-270 flex-col gap-5.5'>
      <PageHeading
        actions={
          <div className='flex flex-wrap items-center gap-3.5'>
            {onProduction ? (
              <label className='flex cursor-pointer items-center gap-2 text-sm text-muted'>
                <input
                  checked={testRun}
                  className='size-4.5 accent-primary'
                  onChange={(event) => setTestRun(event.target.checked)}
                  type='checkbox'
                />
                Test run
              </label>
            ) : null}
            <Button disabled={creating} onClick={() => void createNew()} variant='primary'>
              {creating ? 'Creating…' : 'New tournament'}
            </Button>
          </div>
        }
        className='mb-0 items-end'
        title='Admin'
      />
      {error ? <Alert tone='danger'>{error}</Alert> : null}
      {index.status === 'loading' ? <p className='text-sm text-muted'>Loading the tournaments…</p> : null}
      {index.status === 'unavailable' || index.status === 'error' ? (
        <Alert tone='danger'>The tournament list is unavailable right now.</Alert>
      ) : null}
      {index.status === 'ready' && !groups.length ? (
        <p className='text-sm text-muted'>No tournament in preparation yet.</p>
      ) : null}
      {groups.map((group) => (
        <SectionPanel key={group.title} padded={false} title={group.title.toUpperCase()}>
          <ul>
            {group.summaries.map((summary) => (
              <TournamentRow
                key={summary.id}
                summary={summary}
                onOpen={() => void app.loadTournament(summary.id)}
              />
            ))}
          </ul>
        </SectionPanel>
      ))}
      <p className='text-sm text-muted'>
        Finished tournaments are on the{' '}
        <button
          className='cursor-pointer text-cfp-sky hover:underline focus-visible:outline-2 focus-visible:outline-primary'
          onClick={() => app.setActiveTab('tournaments')}
        >
          Tournaments
        </button>{' '}
        page.
      </p>
    </div>
  );
}
