import { useMemo } from 'react';
import { unitLabelPluralLower } from '../../domain/tournament/formats';
import { computeRankings, type RankingDisplay } from '../../domain/tournament/rankings';
import { rosterKeys, unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { downloadRankingsImage } from './rankings-image';
import { RankingsLists } from './RankingsLists';
import { ManageRoster, ReservePanel } from './RankingsRoster';
import { Alert, Badge, Button, PageHeading, cn } from '../../components/ui';

function Unit({ entry }: { entry: RankingDisplay }) {
  return (
    <span>
      <strong>{entry.label}</strong>
      {entry.members?.length ? (
        <small className='mt-0.5 block font-normal text-muted'>{entry.members.join(' & ')}</small>
      ) : null}
    </span>
  );
}

function RankingGrid({ children }: { children: React.ReactNode }) {
  return <div className='columns-1 gap-3.5 sm:columns-2 xl:columns-3'>{children}</div>;
}

function RankingRow({ children, champion = false }: { children: React.ReactNode; champion?: boolean }) {
  return (
    <div
      className={cn(
        'mb-2 grid min-h-13 break-inside-avoid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-surface-hover bg-surface px-2.5 py-2',
        champion && 'border-success/40 bg-success-soft',
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className='mt-4.5 mb-2 text-[0.72rem] font-semibold tracking-[0.1em] text-muted uppercase'>
      {children}
    </div>
  );
}

function NoShowsPanel({ state }: { state: TournamentState }) {
  const noShows = state.withdrawnUnits.filter((unit) => !unit.playedAnyMatch);
  if (!noShows.length) return null;
  return (
    <>
      <SectionTitle>No-shows (admin only)</SectionTitle>
      <RankingGrid>
        {noShows.map((unit) => (
          <RankingRow key={`noshow-${unit.name}`}>
            <span className='text-center text-lg font-bold text-muted'>—</span>
            <span className='min-w-0'>
              <Unit entry={unit} />
            </span>
            <Badge>No-show</Badge>
          </RankingRow>
        ))}
      </RankingGrid>
    </>
  );
}

function RosterOnly({ state, editable }: { state: TournamentState; editable: boolean }) {
  if (editable) {
    return (
      <>
        <ReservePanel state={state} />
        <ManageRoster state={state} />
        <NoShowsPanel state={state} />
      </>
    );
  }
  const rows = [
    ...rosterKeys(state.players).map((name) => ({ name, badge: 'Registered' })),
    ...rosterKeys(state.reserves).map((name) => ({ name, badge: 'Reserve' })),
  ].sort((a, b) => unitDisplay(state, a.name).label.localeCompare(unitDisplay(state, b.name).label));
  return (
    <RankingGrid>
      {rows.map(({ name, badge }) => {
        const info = unitDisplay(state, name);
        return (
          <RankingRow key={`${badge}-${name}`}>
            <span className='text-center text-lg font-bold text-muted'>—</span>
            <span className='min-w-0'>
              <Unit entry={{ name, ...info }} />
            </span>
            <Badge>{badge}</Badge>
          </RankingRow>
        );
      })}
    </RankingGrid>
  );
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
      {editable ? (
        <ReservePanel state={state} />
      ) : state.reserves.length ? (
        <>
          <SectionTitle>Reserves</SectionTitle>
          <RankingGrid>
            {rosterKeys(state.reserves).map((name) => {
              const info = unitDisplay(state, name);
              return (
                <RankingRow key={name}>
                  <span className='text-center text-lg font-bold text-muted'>—</span>
                  <span className='min-w-0'>
                    <Unit entry={{ name, ...info }} />
                  </span>
                  <Badge>Reserve</Badge>
                </RankingRow>
              );
            })}
          </RankingGrid>
        </>
      ) : null}
      {editable ? (
        <>
          <SectionTitle>Manage roster</SectionTitle>
          <ManageRoster state={state} />
          <NoShowsPanel state={state} />
        </>
      ) : null}
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
