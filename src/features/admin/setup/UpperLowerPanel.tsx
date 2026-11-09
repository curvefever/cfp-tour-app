import { Alert, SectionPanel } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { upperLowerSummary } from './upper-lower-summary';

/** The upper and lower bracket's rooms and rounds, read only, where the Custom bracket's graph sits: the app works them out from the head count. */
export function UpperLowerPanel() {
  const { state, setup } = useTournamentApp();
  if (setup.scheduleLogic !== 'upper-lower') return null;
  const summary = upperLowerSummary(setup, state.confirmedCount || null);
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
        </div>
      )}
    </SectionPanel>
  );
}
