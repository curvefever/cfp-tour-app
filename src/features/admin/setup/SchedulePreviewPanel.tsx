import { useState } from 'react';
import { getGameFormat } from '../../../domain/tournament/formats';
import { Alert, Button, ButtonRow, Panel, PanelTitle, Timeline, TimelineItem } from '../../../components/ui';
import { transitionRefusal } from '../../tournaments/tournament-lifecycle';
import { useTournamentApp } from '../../tournament/TournamentProvider';

/** The generated rounds, and the Confirm & Start button; nothing before a schedule is generated or once started. */
export function SchedulePreviewPanel() {
  const { state, setup, startTournamentNow } = useTournamentApp();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const format = getGameFormat(setup.gameFormat);

  async function confirmAndStart() {
    setStartError('');
    setStarting(true);
    const message = await startTournamentNow();
    setStarting(false);
    if (message) setStartError(message);
  }

  const startRefusal = transitionRefusal('start', {
    status: state.lifecycle?.status ?? 'draft',
    started: false,
    testRun: state.lifecycle?.testRun ?? false,
    title: state.title,
    scheduledAt: state.info?.scheduledAt ?? null,
  });

  if (!state.rounds.length || state.started) return null;
  return (
    <Panel id='preview-wrap'>
      <PanelTitle>Schedule Preview</PanelTitle>
      <Timeline>
        {state.rounds.map((round, index) => (
          <TimelineItem
            key={index}
            label={
              round.isFinal
                ? 'Final'
                : round.bracket === 'winners'
                  ? 'WB'
                  : round.bracket === 'losers'
                    ? 'LB'
                    : `${round.players} ${format?.unitLabelPlural ?? 'Players'}`
            }
          >
            {round.roundNum}
          </TimelineItem>
        ))}
      </Timeline>
      {startRefusal ? <p className='text-xs text-muted'>{startRefusal}</p> : null}
      {startError ? <Alert tone='danger'>{startError}</Alert> : null}
      <ButtonRow>
        <Button
          variant='success'
          disabled={Boolean(startRefusal) || starting}
          onClick={() => void confirmAndStart()}
        >
          {starting ? 'Starting…' : '✓ Confirm & Start'}
        </Button>
      </ButtonRow>
    </Panel>
  );
}
