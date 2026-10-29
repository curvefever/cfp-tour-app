import { useMemo } from 'react';
import { unitLabelPluralLower } from '../../domain/tournament/formats';
import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { downloadRankingsImage } from './rankings-image';
import { AbsentPanel } from './AbsentPanel';
import { PlayersList } from './PlayersList';
import { RankingsLists } from './RankingsLists';
import { ManageRoster, ReservePanel } from './RankingsRoster';
import { Alert, Button, PageHeading, columnTitleClassName } from '../../components/ui';

/** Admins only, below the lists: manage the roster, the reserves and the absentees, in the middle look. */
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
          <AbsentPanel state={state} />
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
    <Button
      className='gap-2 max-[700px]:size-11 max-[700px]:justify-center max-[700px]:px-0'
      onClick={() => void downloadRankingsImage(state)}
    >
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
      <span className='max-[700px]:sr-only'>Download image</span>
    </Button>
  );
}

export function RankingsView() {
  const app = useTournamentApp();
  const title = useTournamentTitle();
  // A viewer never sees a draw before the start (as in tabs.ts); an admin sees it from Generate, to check it.
  const mayShowDraw = app.state.started || app.unlocked;
  const data = useMemo(() => (mayShowDraw ? computeRankings(app.state) : null), [app.state, mayShowDraw]);
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
