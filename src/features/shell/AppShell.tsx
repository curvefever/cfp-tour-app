import { useState } from 'react';
import { hasStandingsPhase } from '../../domain/tournament/standings-display';
import { CfpLoginModal } from '../auth/CfpLoginModal';
import { formatAccountRole } from '../auth/auth.shared';
import { useAuth } from '../auth/AuthProvider';
import { BracketView } from '../bracket/BracketView';
import { HomeView } from '../home/HomeView';
import { SetupView } from '../admin/SetupView';
import { RunningAdmin } from '../admin/RunningAdmin';
import { RankingsView } from '../rankings/RankingsView';
import { StandingsView } from '../standings/StandingsView';
import { ArchiveView } from '../archive/ArchiveView';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { effectiveTab, visibleTabs } from './tabs';
import { Alert, Button, ButtonRow, Modal, Panel, PanelTitle, cn } from '../../components/ui';

export function AppShell() {
  const app = useTournamentApp();
  const auth = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const currentRound = app.state.rounds[app.state.curRound];
  const showStandings = hasStandingsPhase(app.state);
  const tabContext = { canAdmin: app.unlocked, showStandings };
  const tabs = visibleTabs(tabContext);
  const activeTab = effectiveTab(app.activeTab, tabContext);

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <header className='sticky top-0 z-50 flex h-14 items-center justify-between border-b border-surface-hover bg-background/95 px-6 backdrop-blur-md max-[700px]:px-3.5'>
        <button
          className='cursor-pointer whitespace-nowrap text-lg font-bold tracking-[0.16em] text-primary uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[700px]:text-base max-[700px]:tracking-[0.12em]'
          onClick={() => app.setActiveTab('home')}
        >
          CFP <span className='text-foreground'>Tour Hub</span>
        </button>
        <div className='flex min-w-0 items-center gap-2.5'>
          {app.state.title ? (
            <div
              className='max-w-55 overflow-hidden px-2 py-1 text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground max-[700px]:max-w-31'
              title={app.state.title}
            >
              {app.state.title}
            </div>
          ) : null}
          <div className='text-[0.68rem] tracking-[0.1em] text-muted uppercase'>Round</div>
          <div className='text-3xl leading-none font-bold text-primary drop-shadow-[0_0_9px_rgb(0_229_255_/_40%)]'>
            {currentRound?.roundNum ?? '—'}
          </div>
        </div>
      </header>
      <nav
        aria-label='Tournament sections'
        className='sticky top-14 z-40 flex flex-wrap gap-0.5 border-b border-surface-hover bg-background/95 px-6 pt-2.5 backdrop-blur-md max-[700px]:px-2.5 max-[700px]:pt-2'
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'cursor-pointer border-b-2 border-transparent px-4 py-2 text-sm text-muted transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary max-[700px]:flex-auto max-[700px]:px-2',
              activeTab === tab.key && 'border-primary text-primary',
            )}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            onClick={() => app.setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {app.isViewer && app.syncStatus.kind === 'stale' ? (
        <Alert className='mx-auto mt-2.5 w-[min(1100px,calc(100%-24px))]' tone='danger'>
          ⚠ Live connection lost — what you&apos;re seeing may be out of date. Reload to try reconnecting.
        </Alert>
      ) : null}
      <main
        className='mx-auto max-w-7xl px-6 py-5 max-[700px]:px-3 max-[700px]:py-3.5'
        data-hydrated={app.hydrated ? 'true' : 'false'}
      >
        {activeTab === 'home' ? (
          <section id='view-home'>
            <HomeView signedIn={app.unlocked} onLogIn={() => setLoginOpen(true)} />
          </section>
        ) : null}
        {activeTab === 'admin' ? (
          <section id='view-admin'>
            <Panel>
              <PanelTitle>Admin Access</PanelTitle>
              <Alert tone='success'>
                Signed in as <strong>{auth.username}</strong>
                {auth.roles.length ? ` · ${auth.roles.map(formatAccountRole).join(', ')}` : ''}
              </Alert>
              <ButtonRow>
                <Button size='sm' variant='warning' onClick={app.lockAdmin}>
                  Sign out
                </Button>
              </ButtonRow>
            </Panel>
            {app.state.started ? <RunningAdmin /> : <SetupView />}
          </section>
        ) : null}
        {activeTab === 'standings' ? (
          <section id='view-standings'>
            <StandingsView />
          </section>
        ) : null}
        <section id='view-bracket' hidden={activeTab !== 'bracket'}>
          <BracketView />
        </section>
        {activeTab === 'rankings' ? (
          <section id='view-rankings'>
            <RankingsView />
          </section>
        ) : null}
        {activeTab === 'archive' ? (
          <section id='view-archive'>
            <ArchiveView />
          </section>
        ) : null}
      </main>
      {app.isViewer && ['connecting', 'waiting', 'unavailable'].includes(app.syncStatus.kind) ? (
        <div role='status'>
          <Modal
            className='text-center'
            title={
              app.syncStatus.kind === 'waiting'
                ? 'Waiting for the tournament to start…'
                : app.syncStatus.kind === 'unavailable'
                  ? 'Live sync unavailable'
                  : 'Connecting…'
            }
          >
            <p>
              {app.syncStatus.kind === 'waiting'
                ? 'This link is valid, but the organiser hasn’t generated a schedule yet. This page updates automatically once they do.'
                : app.syncStatus.kind === 'unavailable'
                  ? 'The live-sync library couldn’t load — check your connection and reload the page.'
                  : 'Loading the live tournament.'}
            </p>
          </Modal>
        </div>
      ) : null}
      <CfpLoginModal
        open={loginOpen}
        onCancel={() => setLoginOpen(false)}
        onSignedIn={() => {
          app.unlockAdmin();
          setLoginOpen(false);
        }}
      />
    </div>
  );
}
