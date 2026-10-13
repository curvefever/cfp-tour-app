import { useState } from 'react';
import {
  Alert,
  Button,
  ButtonRow,
  Field,
  Input,
  Panel,
  PanelTitle,
  Timeline,
  TimelineItem,
} from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { CorrectCurrentRoundPanel } from './live-corrections/CorrectCurrentRoundPanel';
import { LiveSyncCard, TournamentSettingsRecap } from './RunningAdminStatus';
import { InfoContentPanel } from './InfoContentPanel';
import { ScheduledTimeField } from './ScheduledTimeField';
import { RunningWaterfallPanel } from './waterfall/RunningWaterfallPanel';

export function RunningAdmin() {
  const app = useTournamentApp();
  const state = app.state;
  const round = state.rounds[state.curRound];
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  if (!round) return <Alert tone='danger'>The saved tournament has no current round.</Alert>;

  async function backToDraftNow() {
    setResetError('');
    setResetting(true);
    const message = await app.backToDraft();
    setResetting(false);
    if (message) setResetError(message);
  }
  return (
    <div id='panel-running'>
      <Panel className='pb-1.5'>
        <PanelTitle>Tournament running</PanelTitle>
        <Field htmlFor='running-title' label='Tournament name'>
          <Input
            id='running-title'
            type='text'
            value={state.title}
            placeholder='Unnamed Tournament'
            disabled={app.readOnly}
            onChange={(event) => app.updateState((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <ScheduledTimeField id='running-scheduled-at' />
      </Panel>
      <InfoContentPanel />
      <TournamentSettingsRecap state={state} />
      {state.rounds.some((entry) => entry.isWaterfall) && !app.readOnly ? (
        <RunningWaterfallPanel state={state} />
      ) : null}
      {resetError ? <Alert tone='danger'>{resetError}</Alert> : null}
      <LiveSyncCard />
      {app.readOnly ? null : <CorrectCurrentRoundPanel state={state} />}
      <Panel>
        <PanelTitle>Tournament progress</PanelTitle>
        <Timeline>
          {state.rounds.map((entry, index) => (
            <TimelineItem
              key={index}
              label={entry.isFinal ? 'Final' : entry.isSemis ? 'Semis' : `R${entry.roundNum}`}
              state={index < state.curRound ? 'done' : index === state.curRound ? 'current' : 'upcoming'}
            >
              {index < state.curRound ? '✓' : entry.isFinal ? '🏆' : entry.isSemis ? 'S' : entry.roundNum}
            </TimelineItem>
          ))}
        </Timeline>
      </Panel>
      {app.readOnly ? null : (
        <ButtonRow className='rounded-lg border border-surface-hover p-2.5'>
          <Button
            disabled={resetting}
            onClick={() => {
              if (
                window.confirm(
                  'Send this tournament back to draft? Its players and settings stay; every score and round played is cleared.',
                )
              )
                void backToDraftNow();
            }}
          >
            {resetting ? 'Resetting…' : '↩ Back to draft'}
          </Button>
        </ButtonRow>
      )}
    </div>
  );
}
