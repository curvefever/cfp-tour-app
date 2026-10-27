import { useEffect, useMemo, useState } from 'react';
import { hasPendingColumnTies } from '../../domain/tournament/advancement';
import {
  bracketFollowStatus,
  bracketRoundLabels,
  projectFutureRoundSlots,
} from '../../domain/tournament/bracket';
import { expectedNextColumn } from '../../domain/tournament/expected-draw';
import { resolveUnitQuery, unitDisplay } from '../../domain/tournament/roster';
import { drawnAheadStatus } from '../../domain/tournament/redraw';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import {
  readBracketFollow,
  readRoundSettingsShown,
  saveBracketFollow,
  saveRoundSettingsShown,
} from '../../lib/persistence/storage';
import { Alert, Button, ButtonRow, Input, PageHeading } from '../../components/ui';
import { finishReminderFor } from '../tournaments/admin-actions';
import { AnnotationsPanel, AnnotationsToggle } from './AnnotationsPanel';
import { BracketInfoBox, InfoToggle } from './BracketInfoBox';
import { FinishReminder } from './FinishReminder';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { BracketRounds } from './BracketRounds';
import { FollowBanner } from './FollowBanner';
import { rememberedFollow } from './follow-text';
import { RoundSettingsToggle } from './RoundSettingsToggle';
import { TieBanners } from './TieBanners';
import { destinationLabel } from './exit-text';
import { nextColumnStart, previousColumnStart } from '../../domain/tournament/round-columns';
import { unscoredRooms } from '../../domain/tournament/scoring';
import { unscoredRoomsMessage } from './next-round-warning';
import { hasRoundNotes } from './title-bar-marks';

export function BracketView() {
  const app = useTournamentApp();
  const title = useTournamentTitle();
  const [collapse, setCollapse] = useState<Record<number, boolean>>({});
  const [standingsCollapsed, setStandingsCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settingsShown, setSettingsShown] = useState(true);
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const rosterLoaded = app.state.players.length > 0;
  useEffect(() => {
    if (!app.hydrated) return;
    const stored = rememberedFollow(app.state, readBracketFollow(window.localStorage));
    setFollowKey(stored);
    setQuery(stored ? unitDisplay(app.state, stored).label : '');
    setSettingsShown(readRoundSettingsShown(window.localStorage));
    // Read again when another tournament loads and once its roster arrives, not on every state change.
  }, [app.hydrated, app.state.tournamentId, rosterLoaded]);
  useEffect(() => {
    setCollapse({});
    setStandingsCollapsed(false);
  }, [app.state.tournamentId]);
  const follow = useMemo(() => bracketFollowStatus(app.state, followKey), [app.state, followKey]);
  const labels = bracketRoundLabels(app.state);
  const projectedSlots = useMemo(() => projectFutureRoundSlots(app.state), [app.state]);
  const expectedDraw = useMemo(() => expectedNextColumn(app.state), [app.state]);
  if (!app.state.rounds.length) {
    return (
      <>
        <PageHeading label='Bracket' title={title} />
        <Alert>No tournament has started yet.</Alert>
      </>
    );
  }
  const editable = app.unlocked && !app.isViewer && app.state.started && !app.readOnly;
  const pendingTies = hasPendingColumnTies(app.state);
  const currentRound = app.state.rounds[app.state.curRound];
  const isLastRound =
    nextColumnStart(app.state) >= app.state.rounds.length || currentRound?.bracket === 'grand-final';
  const previousStart = previousColumnStart(app.state);
  const drawnAhead = isLastRound ? 'none' : drawnAheadStatus(app.state, app.state.curRound);
  function advance() {
    // Last-resort backstop: every known failure mode returns a 'blocked'
    // result instead of throwing, but this guards against any
    // future/unanticipated throw deep in the advancement logic crashing the
    // whole Bracket view mid-tournament.
    const unscored = unscoredRooms(app.state);
    if (unscored.length > 0 && !window.confirm(unscoredRoomsMessage(app.state, unscored))) return;
    let result;
    try {
      result = advanceTournamentRound(app.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    if (result.status === 'advanced') {
      setMessage('');
      app.updateState(result.state);
    } else if (result.status === 'blocked') setMessage(result.message);
  }
  function toggleSettings() {
    saveRoundSettingsShown(window.localStorage, !settingsShown);
    setSettingsShown(!settingsShown);
  }
  function chooseFollow(value: string) {
    setQuery(value);
    const resolved = resolveUnitQuery(app.state, value);
    setFollowKey(resolved);
    saveBracketFollow(window.localStorage, resolved);
  }
  return (
    <div id='br-content'>
      <PageHeading label='Bracket' title={title} />
      <div className='relative mb-4.5 flex flex-wrap items-center gap-2.5'>
        <label className='sr-only' htmlFor='br-follow-input'>
          Follow a player
        </label>
        <span className='relative w-60 max-[700px]:w-auto max-[700px]:min-w-0 max-[700px]:flex-1'>
          <Input
            className='h-11 w-full rounded-xs border-2 border-cfp-game-frame bg-cfp-game-deep pr-11 text-[15px] font-semibold'
            id='br-follow-input'
            placeholder='Follow a player or team…'
            type='text'
            value={query}
            onChange={(event) => chooseFollow(event.target.value)}
          />
          {query ? (
            <button
              aria-label='Stop following'
              className='absolute top-0 right-0 flex size-11 cursor-pointer items-center justify-center text-[18px] text-muted hover:text-foreground'
              onClick={() => chooseFollow('')}
              title='Stop following'
              type='button'
            >
              ✕
            </button>
          ) : null}
        </span>
        <FollowBanner
          className='max-[700px]:order-last max-[700px]:basis-full'
          state={app.state}
          followKey={followKey}
          follow={follow}
        />
        <div className='ml-auto flex'>
          {hasRoundNotes(app.state) ? (
            <RoundSettingsToggle shown={settingsShown} onToggle={toggleSettings} />
          ) : null}
          <AnnotationsToggle open={notesOpen} onToggle={() => setNotesOpen((open) => !open)} />
          <InfoToggle open={infoOpen} onToggle={() => setInfoOpen((open) => !open)} />
        </div>
        {notesOpen ? <AnnotationsPanel onClose={() => setNotesOpen(false)} /> : null}
        {infoOpen ? <BracketInfoBox onClose={() => setInfoOpen(false)} state={app.state} /> : null}
      </div>
      {editable ? <TieBanners state={app.state} /> : null}
      {message ? <Alert tone='danger'>{message}</Alert> : null}
      {app.unlocked && !app.isViewer && finishReminderFor(app.state) ? (
        <div className='mb-4.5'>
          <FinishReminder />
        </div>
      ) : null}
      <BracketRounds
        state={app.state}
        labels={labels}
        projectedSlots={projectedSlots}
        expectedDraw={expectedDraw}
        editable={editable}
        followKey={followKey}
        collapse={collapse}
        onToggleCollapse={(roundIndex, collapsed) =>
          setCollapse((current) => ({ ...current, [roundIndex]: !collapsed }))
        }
        standingsCollapsed={standingsCollapsed}
        onToggleStandings={() => setStandingsCollapsed((current) => !current)}
        onOpenFullTable={() => app.setActiveTab('standings')}
        showSettings={settingsShown}
      />
      {editable && drawnAhead !== 'none' ? (
        <div className='mt-4.5 rounded-xs bg-cfp-game-deep px-3.5 py-2.5 text-sm text-muted outline-2 outline-cfp-game-frame'>
          {destinationLabel(nextColumnStart(app.state), labels)}{' '}
          {drawnAhead === 'redraw'
            ? "is already drawn. Next Round re-draws it from this round's results."
            : "is already drawn and locked. Next Round returns to it unchanged; a correction here won't change its draw."}
        </div>
      ) : null}
      {editable ? (
        <ButtonRow className='sticky bottom-2.5 z-20 mt-4.5 rounded-xs bg-cfp-game-deep p-2.5 outline-2 outline-cfp-game-frame'>
          {!isLastRound ? (
            <Button
              variant='success'
              disabled={pendingTies}
              title={pendingTies ? 'Resolve the tie-break above first' : undefined}
              onClick={advance}
            >
              Next Round →
            </Button>
          ) : null}
          {previousStart !== null ? (
            <Button
              onClick={() =>
                app.updateState((current) => ({
                  ...current,
                  curRound: previousColumnStart(current) ?? current.curRound,
                }))
              }
            >
              ← Previous
            </Button>
          ) : null}
        </ButtonRow>
      ) : null}
    </div>
  );
}
