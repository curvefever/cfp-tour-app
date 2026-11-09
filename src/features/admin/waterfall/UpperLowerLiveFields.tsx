import { useState } from 'react';
import { Alert, Button, ButtonRow, Field, Input } from '../../../components/ui';
import { isRoundReached } from '../../../domain/tournament/round-columns';
import type { TournamentState } from '../../../domain/tournament/types';
import {
  applyUpperLowerFields,
  upperLowerUpperFallback,
} from '../../../domain/tournament/upper-lower-replan';
import { useTournamentApp } from '../../tournament/TournamentProvider';

/**
 * While the built-in upper and lower bracket is still in its pooling rounds (no bracket round drawn): "Advance to
 * bracket" and "Upper rooms", editable as in Setup. Save writes them to the settings and works the rooms out again with
 * them, so the app goes on re-working them when the head count changes. From the first bracket round drawn, "Edit
 * graph" is the way.
 */
export function UpperLowerLiveFields({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const [advance, setAdvance] = useState(state.settings?.upperLowerAdvance ?? '');
  const [upper, setUpper] = useState(state.settings?.upperLowerUpper ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const first = state.rounds.findIndex((round) => round.isWaterfall);
  if (!state.gamemodeConfig.upperLowerVersion || first === -1 || isRoundReached(state, first)) return null;
  const fallback = upperLowerUpperFallback(state);

  function save() {
    const result = applyUpperLowerFields(app.state, { advance: advance.trim(), upper: upper.trim() });
    setSaved(result.ok);
    if (result.ok) {
      setError('');
      app.updateState(result.state);
    } else {
      setError(result.message);
    }
  }

  return (
    <div className='mb-4' id='upper-lower-live-fields'>
      <p className='mb-2 text-sm text-muted'>
        The rooms are worked out from the head count and again whenever it changes, until the first bracket
        round is drawn.
      </p>
      {fallback ? (
        <Alert className='mb-3' id='upper-lower-fallback' tone='info'>
          {fallback}
        </Alert>
      ) : null}
      {error ? (
        <Alert className='mb-3' id='upper-lower-live-error' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <div className='grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-x-4'>
        <Field htmlFor='live-upper-lower-advance' label='Advance to bracket (optional)'>
          <Input
            id='live-upper-lower-advance'
            min='1'
            onChange={(event) => {
              setAdvance(event.target.value);
              setSaved(false);
            }}
            placeholder='automatic'
            type='number'
            value={advance}
          />
        </Field>
        <Field htmlFor='live-upper-lower-upper' label='Upper rooms (optional)'>
          <Input
            id='live-upper-lower-upper'
            min='1'
            onChange={(event) => {
              setUpper(event.target.value);
              setSaved(false);
            }}
            placeholder='half'
            type='number'
            value={upper}
          />
        </Field>
      </div>
      <ButtonRow>
        <Button onClick={save} variant='primary'>
          Save
        </Button>
        {saved ? <span className='self-center text-sm text-muted'>Saved.</span> : null}
      </ButtonRow>
    </div>
  );
}
