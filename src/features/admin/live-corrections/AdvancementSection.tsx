import { useState } from 'react';
import {
  advancementEditScope,
  applyAdvancementEdit,
  type AdvancementEditInput,
  type AdvancementScope,
} from '../../../domain/tournament/live-advancement-edit';
import type { TournamentState } from '../../../domain/tournament/types';
import { Alert, Button, ButtonRow, Field, Input } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';

type PoolingScope = Extract<AdvancementScope, { kind: 'pooling' }>;
type BracketScope = Extract<AdvancementScope, { kind: 'bracket' }>;

function SaveRow({ onSave, error }: { onSave: () => void; error: string }) {
  return (
    <>
      {error ? (
        <Alert className='mt-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow className='mt-3'>
        <Button variant='primary' onClick={onSave}>
          Save advancement
        </Button>
      </ButtonRow>
    </>
  );
}

/** Applies the edit against the latest state and reports the first problem. */
function useAdvancementSave() {
  const app = useTournamentApp();
  const [error, setError] = useState('');
  function save(input: AdvancementEditInput) {
    const result = applyAdvancementEdit(app.state, input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
    app.updateState(result.state);
  }
  return { error, save };
}

function PoolingFields({ scope }: { scope: PoolingScope }) {
  const [qualAdv, setQualAdv] = useState(String(scope.qualAdv));
  const [targets, setTargets] = useState(scope.targetsText);
  const { error, save } = useAdvancementSave();
  return (
    <div>
      {scope.qualAdvEditable ? (
        <Field htmlFor='live-qual-adv' label={`Advance to bracket (${scope.minQualAdv}–${scope.maxQualAdv})`}>
          <Input id='live-qual-adv' value={qualAdv} onChange={(event) => setQualAdv(event.target.value)} />
        </Field>
      ) : null}
      <Field htmlFor='live-targets' label='Advancement targets (blank = automatic)'>
        <Input id='live-targets' value={targets} onChange={(event) => setTargets(event.target.value)} />
      </Field>
      <SaveRow error={error} onSave={() => save({ kind: 'pooling', qualAdv, targetsText: targets })} />
    </div>
  );
}

function BracketFields({ scope }: { scope: BracketScope }) {
  const [values, setValues] = useState(scope.rounds.map((round) => String(round.advTotal)));
  const { error, save } = useAdvancementSave();
  return (
    <div>
      {scope.rounds.map((round, index) => (
        <Field
          htmlFor={`live-adv-${round.index}`}
          key={round.index}
          label={`${round.label} — ${round.players} enter, advance`}
        >
          <Input
            id={`live-adv-${round.index}`}
            inputMode='numeric'
            value={values[index]}
            onChange={(event) =>
              setValues(values.map((value, at) => (at === index ? event.target.value : value)))
            }
          />
        </Field>
      ))}
      <p className='text-sm text-muted'>
        Then Semis with {values.at(-1)} (minimum {scope.semisSize}).
      </p>
      <SaveRow error={error} onSave={() => save({ kind: 'bracket', targets: values.map(Number) })} />
    </div>
  );
}

/** The advancement half of "Correct current round"; renders nothing when out of scope. */
export function AdvancementSection({ state }: { state: TournamentState }) {
  const scope = advancementEditScope(state);
  if (scope.kind === 'none') return null;
  // Re-key on what is currently in force so a saved edit or an advance resets the inputs.
  const key =
    scope.kind === 'pooling'
      ? `pooling:${scope.qualAdv}:${scope.targetsText}`
      : scope.rounds.map((round) => `${round.index}:${round.advTotal}`).join('|');
  return (
    <div>
      <h3 className='mb-2 text-sm font-semibold'>Advancement targets</h3>
      {scope.kind === 'pooling' ? (
        <PoolingFields key={key} scope={scope} />
      ) : (
        <BracketFields key={key} scope={scope} />
      )}
    </div>
  );
}
