import { Badge, Button, Panel, PanelTitle } from '../../components/ui';
import { getTourEnvironment } from '../sync/firebase-paths';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { PHASE_LABELS, PHASE_TONES } from './phase-display';
import { isVisibleToViewers, tournamentPhase } from './tournament-lifecycle';
import { tournamentFormatLine } from './tournament-info';

/** The Tournaments tab: a plain list for now (the sections come with the next stage), and the way to sign in as an admin. */
export function TournamentsView({ onLogIn }: { onLogIn: () => void }) {
  const app = useTournamentApp();
  const env = getTourEnvironment(typeof window === 'undefined' ? undefined : window.location.hostname);
  const now = Date.now();
  const visible = app.tournaments.summaries.filter(
    (summary) => app.unlocked || isVisibleToViewers(summary, env),
  );
  return (
    <>
      <Panel>
        <PanelTitle>Tournaments</PanelTitle>
        {!app.visitResolved || app.tournaments.status === 'loading' ? (
          <p className='text-sm text-muted'>Loading the tournaments…</p>
        ) : null}
        {app.visitResolved && app.tournaments.status === 'ready' && !visible.length ? (
          <p className='text-sm text-muted'>No tournament yet.</p>
        ) : null}
        <ul className='flex flex-col gap-2'>
          {visible.map((summary) => {
            const phase = tournamentPhase(summary, now);
            return (
              <li
                key={summary.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-hover px-3 py-2'
              >
                <div className='min-w-0'>
                  <div className='truncate font-semibold'>{summary.title || 'Unnamed Tournament'}</div>
                  <div className='flex flex-wrap items-center gap-2 text-xs text-muted'>
                    <Badge tone={PHASE_TONES[phase]}>{PHASE_LABELS[phase]}</Badge>
                    <span>{tournamentFormatLine(summary)}</span>
                  </div>
                </div>
                <Button size='sm' onClick={() => void app.openTournament(summary)}>
                  Open
                </Button>
              </li>
            );
          })}
        </ul>
      </Panel>
      {app.unlocked ? null : (
        <button
          className='fixed right-4 bottom-4 cursor-pointer text-xs text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          onClick={onLogIn}
        >
          Log in as admin
        </button>
      )}
    </>
  );
}
