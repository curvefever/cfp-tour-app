import { useState } from 'react';
import {
  applyStageMatchEdit,
  stageMatchScope,
  type MatchStage,
  type RoundMatchEntry,
  type StageMatch,
  type StageMatchEntry,
} from '../../../domain/tournament/stage-match-edit';
import type { TournamentState } from '../../../domain/tournament/types';
import { Alert, Button, ButtonRow, Field } from '../../../components/ui';
import { matchFromSelectValue, matchLabelOf, matchSelectValue } from '../setup/format-fields';
import { MatchSelect } from '../setup/MatchSelect';
import { useTournamentApp } from '../../tournament/TournamentProvider';

type StagePicks = Partial<Record<MatchStage, string>>;
/** A round's pick by its name: a select value, '' for its stage's format. */
type RoundPicks = Record<string, string>;

const stagePickOf = (entry: StageMatchEntry) =>
  matchSelectValue(String(entry.games), entry.bestOf?.toString() ?? '');

const roundPickOf = (entry: RoundMatchEntry) =>
  entry.override
    ? matchSelectValue(String(entry.override.games), entry.override.bestOf?.toString() ?? '')
    : '';

/** What the picked select value means for the stage: a Best of N keeps the games the stage remembers. */
function stageMatchOf(entry: StageMatchEntry, pick: string): StageMatch {
  const { games, bestOf } = matchFromSelectValue(pick);
  return {
    games: games === undefined ? entry.games : Number(games),
    ...(bestOf ? { bestOf: Number(bestOf) } : {}),
  };
}

/** What the picked select value means for a round: its own format, or null for its stage's. */
function roundMatchOf(pick: string): StageMatch | null {
  if (!pick) return null;
  const { games, bestOf } = matchFromSelectValue(pick);
  return { games: Number(games ?? 1), ...(bestOf ? { bestOf: Number(bestOf) } : {}) };
}

function StageSelect({
  entry,
  pick,
  onPick,
}: {
  entry: StageMatchEntry;
  pick: string;
  onPick: (value: string) => void;
}) {
  const { games, bestOf } = matchFromSelectValue(pick);
  return (
    <Field htmlFor={`live-match-${entry.stage}`} label={`${entry.label} format`}>
      <MatchSelect
        bestOf={bestOf}
        disabled={entry.locked}
        games={String(games ?? entry.games)}
        id={`live-match-${entry.stage}`}
        onChange={onPick}
      />
    </Field>
  );
}

function RoundSelect({
  entry,
  stageFormat,
  pick,
  onPick,
}: {
  entry: RoundMatchEntry;
  stageFormat: string;
  pick: string;
  onPick: (value: string) => void;
}) {
  const { games, bestOf } = matchFromSelectValue(pick);
  const id = `live-match-round-${entry.index}`;
  return (
    <>
      <label className='pt-2 text-sm leading-5 font-bold wrap-break-word' htmlFor={id}>
        {entry.shown ?? entry.name}
      </label>
      <MatchSelect
        bestOf={bestOf}
        games={games ?? ''}
        id={id}
        inheritLabel={`Stage format (${stageFormat})`}
        onChange={onPick}
      />
    </>
  );
}

function MatchFormatFields({ stages, rounds }: { stages: StageMatchEntry[]; rounds: RoundMatchEntry[] }) {
  const app = useTournamentApp();
  const [stagePicks, setStagePicks] = useState<StagePicks>({});
  const [roundPicks, setRoundPicks] = useState<RoundPicks>({});
  const [error, setError] = useState('');
  const changedStages = stages.filter((entry) => !entry.locked && stagePicks[entry.stage] !== undefined);
  const changedRounds = rounds.filter(
    (entry) => roundPicks[entry.name] !== undefined && roundPicks[entry.name] !== roundPickOf(entry),
  );
  const stageEntry = (stage: MatchStage) => stages.find((entry) => entry.stage === stage) as StageMatchEntry;

  function save() {
    const result = applyStageMatchEdit(
      app.state,
      Object.fromEntries(
        changedStages.map((entry) => [entry.stage, stageMatchOf(entry, stagePicks[entry.stage] as string)]),
      ),
      Object.fromEntries(changedRounds.map((entry) => [entry.name, roundMatchOf(roundPicks[entry.name])])),
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
    setStagePicks({});
    setRoundPicks({});
    app.updateState(result.state);
  }

  function stageFormatOf(stage: MatchStage): string {
    const entry = stageEntry(stage);
    const { games, bestOf } = stageMatchOf(entry, stagePicks[stage] ?? stagePickOf(entry));
    return matchLabelOf(games, bestOf);
  }

  return (
    <div>
      {stages.map((entry) => (
        <StageSelect
          entry={entry}
          key={entry.stage}
          pick={stagePicks[entry.stage] ?? stagePickOf(entry)}
          onPick={(value) => setStagePicks({ ...stagePicks, [entry.stage]: value })}
        />
      ))}
      {rounds.length > 0 ? (
        <div className='mt-3 grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5'>
          {rounds.map((entry) => (
            <RoundSelect
              entry={entry}
              key={entry.name}
              pick={roundPicks[entry.name] ?? roundPickOf(entry)}
              stageFormat={stageFormatOf(entry.stage)}
              onPick={(value) => setRoundPicks({ ...roundPicks, [entry.name]: value })}
            />
          ))}
        </div>
      ) : null}
      {error ? (
        <Alert className='mt-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow className='mt-3'>
        <Button disabled={changedStages.length + changedRounds.length === 0} variant='primary' onClick={save}>
          Save match format
        </Button>
      </ButtonRow>
    </div>
  );
}

/** The match format half of "Correct current round": the stage formats and the rounds not finished yet; renders nothing when out of scope. */
export function MatchFormatSection({ state }: { state: TournamentState }) {
  const scope = stageMatchScope(state);
  if (scope.kind === 'none') return null;
  // Re-key on what is in force so a saved change (or an advance) resets the selects.
  const key = [
    ...scope.stages.map((entry) => `${entry.stage}:${stagePickOf(entry)}:${entry.locked}`),
    ...scope.rounds.map((entry) => `${entry.name}:${roundPickOf(entry)}`),
  ].join('|');
  return (
    <div className='rounded bg-surface-low p-3.5'>
      <h4 className='mb-2.5 text-sm font-bold'>Match format</h4>
      <MatchFormatFields key={key} rounds={scope.rounds} stages={scope.stages} />
    </div>
  );
}
