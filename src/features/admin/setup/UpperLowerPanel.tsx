import { Alert, Button, ButtonRow, SectionPanel } from '../../../components/ui';
import { upperLowerByHand } from '../../../domain/tournament/upper-lower-form';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { upperLowerSummary } from './upper-lower-summary';
import { useSetupUpdate } from './useSetupChange';

/** Asked before "Adjust rounds by hand" hands the rounds over: the app stops working the rooms out. */
const HAND_CONFIRM =
  'The rounds become a Custom bracket graph that you edit yourself: the app will no longer work the rooms out when the head count changes. Choosing "Upper and lower bracket" again works them out again and drops the graph. Continue?';

/** The upper and lower bracket's rooms and rounds, read only, where the Custom bracket's graph sits: the app works them out from the head count. */
export function UpperLowerPanel() {
  const { state, setup } = useTournamentApp();
  const updateSetup = useSetupUpdate();
  if (setup.scheduleLogic !== 'upper-lower') return null;
  const summary = upperLowerSummary(setup, state.confirmedCount || null);

  function adjustByHand() {
    const text = upperLowerByHand(setup, state.confirmedCount ?? 0);
    if (!text.ok || !window.confirm(HAND_CONFIRM)) return;
    updateSetup((current) => ({ ...current, scheduleLogic: 'waterfall-bracket', waterfallGraph: text.text }));
  }

  return (
    <SectionPanel
      hint='worked out from the head count, and again whenever it changes during the pooling rounds'
      title='UPPER AND LOWER BRACKET'
    >
      {summary.kind === 'waiting' ? (
        <p className='text-sm text-muted' id='upper-lower-summary'>
          {summary.message}
        </p>
      ) : summary.kind === 'refused' ? (
        <Alert id='upper-lower-summary' tone='danger'>
          {summary.message}
        </Alert>
      ) : (
        <div id='upper-lower-summary'>
          <p className='mb-3 text-sm font-semibold'>{summary.heading}</p>
          <ul className='flex flex-col gap-1.5'>
            {summary.rounds.map((round) => (
              <li className='flex flex-col text-sm' key={round.name}>
                <span>
                  <b>{round.name}</b> <span className='text-muted'>· {round.rooms}</span>
                </span>
                <span className='text-muted'>{round.goes}</span>
              </li>
            ))}
          </ul>
          <ButtonRow className='mt-3'>
            <Button onClick={adjustByHand}>Adjust rounds by hand</Button>
          </ButtonRow>
        </div>
      )}
    </SectionPanel>
  );
}
