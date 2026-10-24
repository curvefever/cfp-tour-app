import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActiveTab } from '../../domain/tournament/types';
import { CfpLoginModal } from '../auth/CfpLoginModal';
import { formatAccountRole } from '../auth/auth.shared';
import { useAuth } from '../auth/AuthProvider';
import { SessionExpiredBanner } from '../auth/SessionExpiredBanner';
import { useSessionCheck } from '../auth/useSessionCheck';
import { BracketView } from '../bracket/BracketView';
import { InfoView } from '../info/InfoView';
import { AdminTournamentList } from '../admin/AdminTournamentList';
import { LoadedTournamentAdmin } from '../admin/LoadedTournamentAdmin';
import { RankingsView } from '../rankings/RankingsView';
import { StandingsView } from '../standings/StandingsView';
import { TournamentsView } from '../tournaments/TournamentsView';
import { UNAVAILABLE_DETAIL, UNAVAILABLE_NOTICE } from '../tournaments/visit';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { NewVersionBanner } from '../version/NewVersionBanner';
import { useLiveBuildCheck } from '../version/useLiveBuildCheck';
import { AppHeader } from './AppHeader';
import { TabErrorBoundary } from './TabErrorBoundary';
import { effectiveTab, tabContextFor, visibleTabs } from './tabs';
import { Alert, Modal } from '../../components/ui';

/** Admin is the organiser's screen (middle look); every viewer tab is the game look. */
function lookOf(tab: ActiveTab): 'game' | 'middle' {
  return tab === 'admin' ? 'middle' : 'game';
}

/** One tab's content, kept from blanking the page by a render error; reset when another tournament is loaded. */
function TabContent({ children }: { children: ReactNode }) {
  const app = useTournamentApp();
  return (
    <TabErrorBoundary isAdmin={app.unlocked} key={app.state.tournamentId ?? 'none'}>
      {children}
    </TabErrorBoundary>
  );
}

export function AppShell() {
  const app = useTournamentApp();
  const auth = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const buildOutdated = useLiveBuildCheck(app.unlocked);
  useSessionCheck(app.unlocked && !auth.sessionExpired);
  const expiryPrompted = useRef(false);

  // The dialog opens by itself once per expiry; Cancel leaves the banner to open it again.
  useEffect(() => {
    if (!auth.sessionExpired) {
      expiryPrompted.current = false;
      return;
    }
    if (expiryPrompted.current) return;
    expiryPrompted.current = true;
    setLoginOpen(true);
  }, [auth.sessionExpired]);
  const tabContext = tabContextFor({
    state: app.state,
    summary: app.tournaments.summaries.find((entry) => entry.id === app.state.tournamentId),
    canAdmin: app.unlocked,
    stateReceived: !['idle', 'connecting', 'waiting', 'unavailable'].includes(app.syncStatus.kind),
    nowMs: Date.now(),
  });
  const tabs = visibleTabs(tabContext);
  const activeTab = effectiveTab(app.activeTab, tabContext);

  return (
    <div className='min-h-screen bg-background text-foreground' data-look={lookOf(activeTab)}>
      <AppHeader
        account={
          app.unlocked
            ? {
                name: auth.username,
                role: auth.roles.map(formatAccountRole).join(', '),
                onSignOut: app.lockAdmin,
              }
            : null
        }
        activeTab={activeTab}
        onHome={() => app.setActiveTab('tournaments')}
        onSelectTab={app.setActiveTab}
        tabs={tabs}
        tournamentLoaded={tabContext.phase !== null}
      />
      {app.isViewer && app.syncStatus.kind === 'stale' ? (
        <Alert className='mx-auto mt-2.5 w-[min(1100px,calc(100%-24px))]' tone='danger'>
          ⚠ Live connection lost — what you&apos;re seeing may be out of date. Reload to try reconnecting.
        </Alert>
      ) : null}
      {app.unlocked && buildOutdated ? <NewVersionBanner /> : null}
      {app.unlocked && auth.sessionExpired ? (
        <SessionExpiredBanner onSignIn={() => setLoginOpen(true)} />
      ) : null}
      <main
        className='mx-auto max-w-7xl px-6 py-5 max-[700px]:px-3 max-[700px]:py-3.5'
        data-hydrated={app.hydrated ? 'true' : 'false'}
      >
        {activeTab === 'tournaments' ? (
          <section id='view-tournaments'>
            <TabContent>
              {app.visitNotice ? (
                <Alert
                  className='mb-6.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-4.5 py-3.5 text-base'
                  role='status'
                  tone='warning'
                >
                  <span className='font-bold text-cfp-orange-text'>{app.visitNotice}</span>
                  {app.visitNotice === UNAVAILABLE_NOTICE ? (
                    <span className='text-foreground'>{UNAVAILABLE_DETAIL}</span>
                  ) : null}
                  <button className='ml-auto cursor-pointer underline' onClick={app.dismissVisitNotice}>
                    Dismiss
                  </button>
                </Alert>
              ) : null}
              <TournamentsView onLogIn={() => setLoginOpen(true)} />
            </TabContent>
          </section>
        ) : null}
        {activeTab === 'info' ? (
          <section id='view-info'>
            <TabContent>
              <InfoView />
            </TabContent>
          </section>
        ) : null}
        {activeTab === 'admin' ? (
          <section id='view-admin'>
            <TabContent>
              {app.state.tournamentId ? <LoadedTournamentAdmin /> : <AdminTournamentList />}
            </TabContent>
          </section>
        ) : null}
        {activeTab === 'standings' ? (
          <section id='view-standings'>
            <TabContent>
              <StandingsView />
            </TabContent>
          </section>
        ) : null}
        <section id='view-bracket' hidden={activeTab !== 'bracket'}>
          <TabContent>
            <BracketView />
          </TabContent>
        </section>
        {activeTab === 'rankings' ? (
          <section id='view-rankings'>
            <TabContent>
              <RankingsView />
            </TabContent>
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
          // An expired tab is still unlocked: signing in again must not move it to the Admin tab.
          if (!app.unlocked) app.unlockAdmin();
          setLoginOpen(false);
        }}
      />
    </div>
  );
}
