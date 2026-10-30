import { useState } from 'react';
import {
  applyStageMatchEdit,
  stageMatchScope,
  type MatchStage,
  type StageMatchEntry,
} from '../../../domain/tournament/stage-match-edit';
import type { TournamentState } from '../../../domain/tournament/types';
import { Alert, Button, ButtonRow, Field } from '../../../components/ui';
import { matchFromSelectValue, matchSelectValue } from '../setup/format-fields';
import { MatchSelect } from '../setup/MatchSelect';
import { useTournamentApp } from '../../tournament/TournamentProvider';

type Picks = Partial<Record<MatchStage, string>>;

const pickOf = (entry: StageMatchEntry) =>
  matchSelectValue(String(entry.games), entry.bestOf?.toString() ?? '');

/** What the picked select value means for the stage: a Best of N keeps the games the stage remembers. */
function matchOf(entry: StageMatchEntry, pick: string) {
  const { games, bestOf } = matchFromSelectValue(pick);
  return {
    games: games === undefined ? entry.games : Number(games),
    ...(bestOf ? { bestOf: Number(bestOf) } : {}),
  };
}

function StageFields({ stages }: { stages: StageMatchEntry[] }) {
  const app = useTournamentApp();
  const [picks, setPicks] = useState<Picks>({});
  const [error, setError] = useState('');
  const changed = stages.filter((entry) => !entry.locked && picks[entry.stage] !== undefined);

  function save() {
    const input = Object.fromEntries(
      changed.map((entry) => [entry.stage, matchOf(entry, picks[entry.stage] as string)]),
    );
    const result = applyStageMatchEdit(app.state, input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
    setPicks({});
    app.updateState(result.state);
  }

  return (
    <div>
      {stages.map((entry) => (
        <Field htmlFor={`live-match-${entry.stage}`} key={entry.stage} label={`${entry.label} format`}>
          <MatchSelect
            bestOf={matchFromSelectValue(picks[entry.stage] ?? pickOf(entry)).bestOf}
            disabled={entry.locked}
            games={String(matchOf(entry, picks[entry.stage] ?? pickOf(entry)).games)}
            id={`live-match-${entry.stage}`}
            onChange={(value) => setPicks({ ...picks, [entry.stage]: value })}
          />
        </Field>
      ))}
      {error ? (
        <Alert className='mt-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow className='mt-3'>
        <Button disabled={changed.length === 0} variant='primary' onClick={save}>
          Save match format
        </Button>
      </ButtonRow>
    </div>
  );
}

/** The Semis and Finals format half of "Correct current round"; renders nothing when out of scope. */
export function MatchFormatSection({ state }: { state: TournamentState }) {
  const scope = stageMatchScope(state);
  if (scope.kind === 'none') return null;
  // Re-key on what is in force so a saved change (or an advance) resets the selects.
  const key = scope.stages.map((entry) => `${entry.stage}:${pickOf(entry)}:${entry.locked}`).join('|');
  return (
    <div className='rounded bg-surface-low p-3.5'>
      <h4 className='mb-2.5 text-sm font-bold'>Match format</h4>
      <StageFields key={key} stages={scope.stages} />
    </div>
  );
}
