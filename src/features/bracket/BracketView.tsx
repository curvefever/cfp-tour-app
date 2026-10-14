import { useEffect, useMemo, useState } from 'react';
import { hasPendingTies } from '../../domain/tournament/advancement';
import {
  bracketFollowStatus,
  bracketRoundLabels,
  projectFutureRoundSlots,
} from '../../domain/tournament/bracket';
import { resolveUnitQuery, unitDisplay } from '../../domain/tournament/roster';
import { drawnAheadStatus } from '../../domain/tournament/redraw';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import { readBracketFollow, saveBracketFollow } from '../../lib/persistence/storage';
import { Alert, Button, ButtonRow, Input, PageHeading } from '../../components/ui';
import { FINISH_REMINDER, finishReminderFor } from '../tournaments/admin-actions';
import { AnnotationsPanel, AnnotationsToggle } from './AnnotationsPanel';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { useTournamentTitle } from '../tournament/useTournamentTitle';
import { BracketRounds } from './BracketRounds';
import { FollowBanner } from './FollowBanner';
import { TieBanners } from './TieBanners';
import { destinationLabel } from './exit-text';

export function BracketView() {
  const app = useTournamentApp();
  const title = useTournamentTitle();
  const [collapse, setCollapse] = useState<Record<number, boolean>>({});
  const [standingsCollapsed, setStandingsCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!app.hydrated) return;
    const stored = readBracketFollow(window.localStorage);
    setFollowKey(stored);
    if (stored) setQuery(unitDisplay(app.state, stored).label);
  }, [app.hydrated]);
  useEffect(() => {
    setCollapse({});
    setStandingsCollapsed(false);
  }, [app.state.tournamentId]);
  const follow = useMemo(() => bracketFollowStatus(app.state, followKey), [app.state, followKey]);
  const labels = bracketRoundLabels(app.state);
  const projectedSlots = useMemo(() => projectFutureRoundSlots(app.state), [app.state]);
  if (!app.state.rounds.length) {
    return (
      <>
        <PageHeading label='Bracket' title={title} />
        <Alert>No tournament has started yet.</Alert>
      </>
    );
  }
  const editable = app.unlocked && !app.isViewer && app.state.started && !app.readOnly;
  const pendingTies = hasPendingTies(app.state, app.state.curRound);
  const currentRound = app.state.rounds[app.state.curRound];
  const isLastRound =
    app.state.curRound >= app.state.rounds.length - 1 || currentRound?.bracket === 'grand-final';
  const drawnAhead = isLastRound ? 'none' : drawnAheadStatus(app.state, app.state.curRound);
  function advance() {
    // Last-resort backstop: every known failure mode returns a 'blocked'
    // result instead of throwing, but this guards against any
    // future/unanticipated throw deep in the advancement logic crashing the
    // whole Bracket view mid-tournament.
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
        <Input
          className='h-11 w-60 rounded-xs border-2 border-cfp-game-frame bg-cfp-game-deep text-[15px] font-semibold'
          id='br-follow-input'
          placeholder='Follow a player or team…'
          type='text'
          value={query}
          onChange={(event) => chooseFollow(event.target.value)}
        />
        <FollowBanner state={app.state} followKey={followKey} follow={follow} />
        <AnnotationsToggle open={notesOpen} onToggle={() => setNotesOpen((open) => !open)} />
      </div>
      {notesOpen ? <AnnotationsPanel /> : null}
      {editable ? <TieBanners state={app.state} /> : null}
      {message ? <Alert tone='danger'>{message}</Alert> : null}
      {app.unlocked && !app.isViewer && finishReminderFor(app.state) ? (
        <Alert tone='warning' className='mb-2.5'>
          {FINISH_REMINDER}{' '}
          <button className='cursor-pointer underline' onClick={() => app.setActiveTab('admin')}>
            Open Admin
          </button>
        </Alert>
      ) : null}
      <BracketRounds
        state={app.state}
        labels={labels}
        projectedSlots={projectedSlots}
        editable={editable}
        followKey={followKey}
        collapse={collapse}
        onToggleCollapse={(roundIndex, collapsed) =>
          setCollapse((current) => ({ ...current, [roundIndex]: !collapsed }))
        }
        standingsCollapsed={standingsCollapsed}
        onToggleStandings={() => setStandingsCollapsed((current) => !current)}
        onOpenFullTable={() => app.setActiveTab('standings')}
      />
      {editable && drawnAhead !== 'none' ? (
        <Alert className='mt-2.5'>
          {destinationLabel(app.state.curRound + 1, labels)}{' '}
          {drawnAhead === 'redraw'
            ? "is already drawn. Next Round re-draws it from this round's results."
            : "is already drawn and locked. Next Round returns to it unchanged; a correction here won't change its draw."}
        </Alert>
      ) : null}
      {editable ? (
        <ButtonRow className='sticky bottom-2.5 z-20 rounded-lg border border-surface-hover bg-background/90 p-2.5 backdrop-blur-md'>
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
          {app.state.curRound > 0 ? (
            <Button
              onClick={() => app.updateState((current) => ({ ...current, curRound: current.curRound - 1 }))}
            >
              ← Previous
            </Button>
          ) : null}
        </ButtonRow>
      ) : null}
    </div>
  );
}
