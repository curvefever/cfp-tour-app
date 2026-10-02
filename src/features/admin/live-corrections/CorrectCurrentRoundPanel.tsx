import { advancementEditScope } from '../../../domain/tournament/live-advancement-edit';
import { lineupEditScope } from '../../../domain/tournament/lineup-edit';
import type { TournamentState } from '../../../domain/tournament/types';
import { Alert, Panel, PanelTitle } from '../../../components/ui';
import { AdvancementSection } from './AdvancementSection';
import { LineupSection } from './LineupSection';

/**
 * Admin-tab panel for mid-tournament corrections: the current round's
 * line-up and the advancement counts. Shown only while at least one of the
 * two is in scope; each section decides for itself what to show.
 */
export function CorrectCurrentRoundPanel({ state }: { state: TournamentState }) {
  const lineup = lineupEditScope(state);
  const advancement = advancementEditScope(state);
  if (!lineup.ok && advancement.kind === 'none') return null;
  return (
    <Panel>
      <PanelTitle>Correct current round</PanelTitle>
      <Alert className='mb-3' tone='info'>
        Changes apply immediately for everyone watching.
      </Alert>
      <LineupSection state={state} />
      <div className='mt-4'>
        <AdvancementSection state={state} />
      </div>
    </Panel>
  );
}
