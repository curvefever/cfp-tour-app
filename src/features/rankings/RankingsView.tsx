import { useMemo } from 'react';
import { unitLabelPluralLower } from '../../domain/tournament/formats';
import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { downloadRankingsImage } from './rankings-image';
import { PlayersList } from './PlayersList';
import { RankingsLists } from './RankingsLists';
import { ManageRoster, ReservePanel } from './RankingsRoster';
import { ToolPanel, ToolRow } from './ToolPanel';
import { Alert, Badge, Button, PageHeading, columnTitleClassName } from '../../components/ui';

function NoShowsPanel({ state }: { state: TournamentState }) {
  const noShows = state.withdrawnUnits.filter((unit) => !unit.playedAnyMatch);
  if (!noShows.length) return null;
  return (
    <ToolPanel title='No-shows'>
      {noShows.map((unit) => (
        <ToolRow controls={<Badge>No-show</Badge>} key={`noshow-${unit.name}`}>
          {unit.label}
        </ToolRow>
      ))}
    </ToolPanel>
  );
}

/** Admins only, below the lists: manage the roster, the reserves and the no-shows, in the middle look. */
function OrganiserTools({ state }: { state: TournamentState }) {
  return (
    <section aria-labelledby='organiser-tools' className='mt-2 flex flex-col gap-3.5' data-look='middle'>
      <div className='flex h-11.5 flex-wrap items-center gap-2.5 rounded-xs bg-cfp-game-title px-3.5'>
        <h2 className={columnTitleClassName} id='organiser-tools'>
          Organiser tools
        </h2>
        <div className='text-[13px] text-muted'>Only admins see this part</div>
      </div>
      <div className='flex flex-wrap items-start gap-4'>
        <ManageRoster state={state} />
        <div className='flex min-w-0 flex-[1_1_300px] flex-col gap-4'>
          <ReservePanel state={state} />
          <NoShowsPanel state={state} />
        </div>
      </div>
    </section>
  );
}

function RosterOnly({ state, editable }: { state: TournamentState; editable: boolean }) {
  return editable ? <OrganiserTools state={state} /> : <PlayersList state={state} />;
}

export function RankingsContent({
  data,
  editable = false,
  state,
}: {
  data: ReturnType<typeof computeRankings>;
  editable?: boolean;
  state: TournamentState;
}) {
  if (!state.players.length && !state.reserves.length) {
    return (
      <Alert>
        No {unitLabelPluralLower(state.gameFormat)} registered yet — check back once the organiser loads a
        roster.
      </Alert>
    );
  }
  if (!data) return <RosterOnly state={state} editable={editable} />;
  return (
    <div id='rk-content'>
      <RankingsLists data={data} state={state} />
      {editable ? <OrganiserTools state={state} /> : null}
    </div>
  );
}

function DownloadImageButton({ state }: { state: TournamentState }) {
  return (
    <Button className='gap-2' onClick={() => void downloadRankingsImage(state)}>
      <svg aria-hidden='true' height='16' viewBox='0 0 16 16' width='16'>
        <path
          d='M8 2 V10 M4.5 6.8 L8 10.2 L11.5 6.8 M2.5 13.5 H13.5'
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth='2'
        />
      </svg>
      Download image
    </Button>
  );
}

export function RankingsView() {
  const app = useTournamentApp();
  const title = useTournamentTitle();
  const data = useMemo(() => computeRankings(app.state), [app.state]);
  return (
    <>
      <PageHeading
        actions={data ? <DownloadImageButton state={app.state} /> : null}
        label={app.state.started ? 'Rankings' : 'Players'}
        title={title}
      />
      <RankingsContent
        data={data}
        editable={app.unlocked && !app.isViewer && !app.readOnly}
        state={app.state}
      />
    </>
  );
}
