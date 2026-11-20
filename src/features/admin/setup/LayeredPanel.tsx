import { Alert, Button, ButtonRow, SectionPanel } from '../../../components/ui';
import { USUAL_FORM_VALUES, layeredByHand } from '../../../domain/tournament/layered-form';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { LayeredGrids } from './LayeredGrid';
import { layeredSummary, type SummaryNumber } from './layered-summary';
import { LayeredTopCounts, TypedTopCounts } from './LayeredTopCounts';
import { useSetupUpdate } from './useSetupChange';

/** Asked before "Adjust rounds by hand" hands the rounds over: the app stops working the rooms out. */
const HAND_CONFIRM =
  'The rounds become a Custom bracket graph that you edit yourself: the app will no longer work the levels and rooms out. Choosing "Layered bracket" again works them out again and drops the graph. Continue?';

const USUAL_LINE =
  'The usual tournament has 4 table rounds with the first not counted, and two games for the Semi-Finals and the Final. The form has other values.';

function NumberList({ numbers }: { numbers: SummaryNumber[] }) {
  return (
    <ul className='flex flex-col gap-1.5' id='layered-numbers'>
      {numbers.map((number) => (
        <li className='flex flex-col text-sm' key={number.key}>
          <span>
            <b>{number.label}</b> <span>{number.value}</span>
          </span>
          <span className='text-muted'>{number.source}</span>
        </li>
      ))}
    </ul>
  );
}

/** The layered bracket's levels, rooms and rounds, read only, where the Custom bracket's graph sits: the app works them out from the head count and what is typed. */
export function LayeredPanel() {
  const { state, setup } = useTournamentApp();
  const updateSetup = useSetupUpdate();
  if (setup.scheduleLogic !== 'layered') return null;
  const summary = layeredSummary(setup, state.confirmedCount || null);

  function adjustByHand() {
    const text = layeredByHand(setup, state.confirmedCount ?? 0);
    if (!text.ok || !window.confirm(HAND_CONFIRM)) return;
    updateSetup((current) => ({ ...current, scheduleLogic: 'waterfall-bracket', waterfallGraph: text.text }));
  }

  function setTopCounts(text: string) {
    updateSetup((current) => ({ ...current, layeredTopCounts: text }));
  }

  function useUsualValues() {
    updateSetup((current) => ({ ...current, ...USUAL_FORM_VALUES }));
  }

  return (
    <SectionPanel
      hint='worked out from the head count and what you type; type a number to plan around it'
      title='LAYERED BRACKET'
    >
      {summary.kind === 'waiting' ? (
        <p className='text-sm text-muted' id='layered-summary'>
          {summary.message}
        </p>
      ) : summary.kind === 'refused' ? (
        <div id='layered-summary'>
          <Alert tone='danger'>{summary.message}</Alert>
          <TypedTopCounts
            lines={summary.typedTopCounts}
            onTopCounts={setTopCounts}
            topCountsText={setup.layeredTopCounts}
          />
        </div>
      ) : (
        <div className='flex flex-col gap-4' id='layered-summary'>
          <p className='text-sm font-semibold'>{summary.heading}</p>
          <NumberList numbers={summary.numbers} />
          <LayeredTopCounts
            noLongerApply={summary.noLongerApply}
            rows={summary.topCounts}
            onSemiOthers={(value) => updateSetup((current) => ({ ...current, layeredSemiOthers: value }))}
            onTopCounts={setTopCounts}
            semiOthers={summary.semiOthers}
            topCountsText={setup.layeredTopCounts}
          />
          {summary.flags.length > 0 ? (
            <ul className='flex flex-col gap-1 text-sm text-warning' id='layered-flags'>
              {summary.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          ) : null}
          <LayeredGrids grid={summary.grid} id='layered-grid' />
          {summary.differsFromUsual ? (
            <div className='flex flex-col gap-2' id='layered-usual'>
              <p className='text-sm text-muted'>{USUAL_LINE}</p>
              <ButtonRow>
                <Button onClick={useUsualValues}>Use the usual values</Button>
              </ButtonRow>
            </div>
          ) : null}
          <ButtonRow>
            <Button onClick={adjustByHand}>Adjust rounds by hand</Button>
          </ButtonRow>
        </div>
      )}
    </SectionPanel>
  );
}
