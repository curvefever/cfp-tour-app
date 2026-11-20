import { useMemo, useState } from 'react';
import { Alert, Button, ButtonRow } from '../../../components/ui';
import {
  LAYERED_OVERRIDE_KEYS,
  checkLayeredPlan,
  keepLayeredPlan,
  acceptLayeredPlan,
  type LayeredOverrides,
} from '../../../domain/tournament/layered-replan';
import type { LayeredPlan } from '../../../domain/tournament/layered-plan';
import type { TournamentState } from '../../../domain/tournament/types';
import { LayeredFields, type LayeredFieldKey } from '../setup/LayeredFields';
import { LayeredGrids } from '../setup/LayeredGrid';
import { LayeredTopCounts, TypedTopCounts } from '../setup/LayeredTopCounts';
import { gridOf, layeredSummary, planHeading } from '../setup/layered-summary';
import { useTournamentApp } from '../../tournament/TournamentProvider';

/** One plan under its title: the line over it and the rounds by levels. */
function PlanBlock({
  title,
  plan,
  registered,
  firstRound,
  id,
}: {
  title: string;
  plan: LayeredPlan;
  registered: number;
  firstRound: number;
  id: string;
}) {
  return (
    <section className='min-w-0' id={id}>
      <b className='mb-1 block text-sm'>{title}</b>
      <p className='mb-2 text-sm font-semibold'>{planHeading(plan, registered)}</p>
      <LayeredGrids grid={gridOf(plan, firstRound)} />
    </section>
  );
}

/**
 * A new plan while the table runs: the app's plan for the number who play now, beside the plan in use. Nothing changes
 * until "Use the new plan" is pressed; "Keep the current plan" hides the card until that number moves. The typed numbers
 * can be changed here until the first bracket round is drawn (the card is gone from then on).
 */
export function LayeredPlanCard({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const [draft, setDraft] = useState<LayeredOverrides>({});
  const [error, setError] = useState('');
  const waiting = useMemo(() => checkLayeredPlan(state), [state]);
  const proposal = useMemo(() => checkLayeredPlan(state, draft), [state, draft]);
  if (waiting.kind !== 'new' || !state.settings) return null;

  const stored = state.settings;
  const typed = { ...stored, ...draft };
  const registered = waiting.registered;
  const next = proposal.kind === 'new' ? proposal : waiting;
  const form = { ...typed, layeredExpected: `${waiting.playNow}` };
  const summary = layeredSummary(form, registered, waiting.firstRound);

  function change(key: LayeredFieldKey, value: string) {
    if (key === 'layeredExpected') return;
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function setTopCounts(text: string) {
    setDraft((current) => ({ ...current, layeredTopCounts: text }));
    setError('');
  }

  function useNewPlan() {
    const result = acceptLayeredPlan(app.state, draft);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft({});
    app.updateState(result.state);
  }

  function keepPlan() {
    setDraft({});
    app.updateState(keepLayeredPlan(app.state));
  }

  const changed = LAYERED_OVERRIDE_KEYS.some((key) => (draft[key] ?? stored[key]) !== stored[key]);

  return (
    <div className='mb-4 rounded border border-primary p-3' id='layered-plan-card'>
      <b className='block text-sm'>A NEW PLAN FOR THE BRACKET</b>
      <p className='mb-3 mt-1 text-sm text-muted'>
        {waiting.playNow} play now, and the plan in use was made for {layeredPlanMadeFor(waiting.inUse)}.
        Nothing changes until you use the new plan.
      </p>
      <div className='grid gap-4 xl:grid-cols-2'>
        {waiting.inUse ? (
          <PlanBlock
            firstRound={waiting.firstRound}
            id='layered-plan-in-use'
            plan={waiting.inUse}
            registered={Math.max(registered, waiting.inUse.play.value)}
            title='The plan in use'
          />
        ) : (
          <p className='text-sm text-muted' id='layered-plan-in-use'>
            The plan in use cannot be shown again from the settings. It stays as it is.
          </p>
        )}
        {proposal.kind === 'new' ? (
          <PlanBlock
            firstRound={proposal.firstRound}
            id='layered-plan-new'
            plan={next.next}
            registered={registered}
            title='The new plan'
          />
        ) : (
          <div id='layered-plan-new'>
            <Alert tone='danger'>{proposal.kind === 'refused' ? proposal.message : 'No new plan.'}</Alert>
            {summary.kind === 'refused' ? (
              <TypedTopCounts
                lines={summary.typedTopCounts}
                onTopCounts={setTopCounts}
                topCountsText={typed.layeredTopCounts}
              />
            ) : null}
          </div>
        )}
      </div>
      <div className='mt-4' id='layered-plan-fields'>
        <b className='mb-2 block text-sm'>Typed numbers</b>
        <div className='grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-x-4'>
          <LayeredFields
            form={form}
            hide={['layeredExpected']}
            idPrefix='live'
            onChange={change}
            registered={registered}
          />
        </div>
        {summary.kind === 'ready' ? (
          <LayeredTopCounts
            noLongerApply={summary.noLongerApply}
            onSemiOthers={(value) => setDraft((current) => ({ ...current, layeredSemiOthers: value }))}
            onTopCounts={setTopCounts}
            rows={summary.topCounts}
            semiOthers={summary.semiOthers}
            topCountsText={typed.layeredTopCounts}
          />
        ) : null}
      </div>
      {error ? (
        <Alert className='mt-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow className='mt-3'>
        <Button disabled={proposal.kind !== 'new'} onClick={useNewPlan} variant='primary'>
          Use the new plan
        </Button>
        <Button onClick={keepPlan}>Keep the current plan</Button>
        {changed ? (
          <span className='self-center text-sm text-muted'>
            Your typed numbers are used when you use the new plan.
          </span>
        ) : null}
      </ButtonRow>
    </div>
  );
}

const layeredPlanMadeFor = (inUse: LayeredPlan | null): string =>
  inUse ? `${inUse.play.value} who play` : 'another number who play';
