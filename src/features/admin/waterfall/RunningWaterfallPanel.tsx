import { useState } from 'react';
import { swissRoutesItsStandings } from '../../../domain/tournament/pooling';
import { rosterKeys } from '../../../domain/tournament/roster';
import type { TournamentState } from '../../../domain/tournament/types';
import type { StandingsSourceKind } from '../../../domain/tournament/waterfall-bracket';
import {
  finalsMatchOf,
  serializeWaterfallDraft,
  waterfallDraftFromRounds,
} from '../../../domain/tournament/waterfall-draft';
import {
  applyHandGraphEdit,
  type WaterfallGraphEditResult,
} from '../../../domain/tournament/waterfall-live-edit';
import { Alert, Button, ButtonRow } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { ProgressSubsection } from '../ProgressSubsection';
import { UpperLowerLiveFields } from './UpperLowerLiveFields';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';
import { isCurrentRound, isRoundReached } from '../../../domain/tournament/round-columns';

/** Said while the tournament is an upper and lower bracket: a hand edit ends the automatic rooms (`applyHandGraphEdit`). */
const HAND_EDIT_MESSAGE =
  'Saving here makes this a Custom bracket: the app stops working the rooms out when the head count changes.';

const CAUTION_MESSAGE =
  "The tournament is running. Rounds that have started keep their rooms; you can still change where their players go next. Saving re-sorts players using the results already entered. If the current round's line-up changes, its rooms are re-drawn, which is only possible before any score is entered there.";

/** Labels of every reached waterfall round, and which ones are being played now (every round of the current column). */
function reachedRounds(state: TournamentState): {
  lockedRounds: Set<string>;
  currentRoundLabels: Set<string>;
} {
  const lockedRounds = new Set<string>();
  const currentRoundLabels = new Set<string>();
  state.rounds.forEach((round, index) => {
    if (!round.isWaterfall || !isRoundReached(state, index) || !round.customLabel) return;
    lockedRounds.add(round.customLabel);
    if (isCurrentRound(state, index)) currentRoundLabels.add(round.customLabel);
  });
  return { lockedRounds, currentRoundLabels };
}

/** Which pooling exit feeds the graph: a qualification table or a Swiss (Qual line), a group stage that routes its exit (Groups line), or neither. */
function standingsKindOf(state: TournamentState): StandingsSourceKind | null {
  if (state.cfg.poolingPhase === 'qual-table' && state.rounds.some((round) => round.isQual)) return 'qual';
  if (swissRoutesItsStandings(state)) return 'qual';
  const routesExit = state.rounds.some((round) => round.isGroupStage && round.standingsRoutes);
  return state.cfg.poolingPhase === 'group-stage' && routesExit ? 'groups' : null;
}

/** The stored column of every round that has started, by label. */
function startedColumnsOf(state: TournamentState, lockedRounds: ReadonlySet<string>): Record<string, number> {
  const columns: Record<string, number> = {};
  for (const round of state.rounds) {
    if (round.customLabel && lockedRounds.has(round.customLabel) && round.waterfallColumn !== undefined) {
      columns[round.customLabel] = round.waterfallColumn;
    }
  }
  return columns;
}

/** The Finals format the tournament was generated with: a round of the graph with no format of its own plays it. */
function finalsMatchOfState(state: TournamentState) {
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  return finalsMatchOf(finalsGames, finalsBestOf);
}

function savedText(state: TournamentState): string {
  const rankCount = rosterKeys(state.players).length;
  return serializeWaterfallDraft(
    waterfallDraftFromRounds(state.rounds, { rankCount, finalsMatch: finalsMatchOfState(state) }),
  );
}

/** Admin-only view of a running waterfall bracket's graph, rebuilt from `state.rounds` (the live source of truth), not the `settings.waterfallGraph` snapshot. */
export function RunningWaterfallPanel({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [redrawPrompt, setRedrawPrompt] = useState<string | null>(null);

  const roomSize = state.gamemodeConfig.roomSize;
  if (!roomSize) return null;
  const entryRound = state.rounds.find((round) => round.isWaterfall);
  // A round added here is named on from the tournament's own numbering (its bracket's first round), and never renumbered.
  const firstRoundNumber = entryRound?.roundNum ?? 1;
  const standingsKind = standingsKindOf(state);
  const standingsSource = standingsKind !== null;
  const entrantCount = standingsSource ? rosterKeys(state.players).length : (entryRound?.players ?? null);
  // What the editor needs to name the source and label the ranks of a Groups line.
  const sourceProps = {
    standingsKind: standingsKind ?? undefined,
    afterSwiss: swissRoutesItsStandings(state),
    groupSizes: standingsKind === 'groups' ? state.groups.map((group) => group.members.length) : null,
    groupExit: state.cfg.groupExit ?? ('per-group' as const),
  };
  const { lockedRounds, currentRoundLabels } = reachedRounds(state);
  // A tournament generated before columns existed plays one round at a time once its bracket has started,
  // and its rounds keep no column; before that, a save gives it columns.
  const bracketEntered = entryRound !== undefined && isRoundReached(state, state.rounds.indexOf(entryRound));
  const showColumns = entryRound?.waterfallColumn !== undefined || !bracketEntered;
  const startedColumns = startedColumnsOf(state, lockedRounds);

  function startEdit() {
    setDraftText(savedText(state));
    setError('');
    setSuccess('');
    setRedrawPrompt(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setRedrawPrompt(null);
    setError('');
  }

  function apply(result: WaterfallGraphEditResult & { ok: true }) {
    app.updateState(result.state);
    setEditing(false);
    setRedrawPrompt(null);
    setSuccess(result.redrawnRound ? `Graph saved, "${result.redrawnRound}" re-drawn.` : 'Graph saved.');
  }

  function save() {
    setError('');
    const result = applyHandGraphEdit(app.state, draftText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.redrawnRound) {
      setRedrawPrompt(result.redrawnRound);
      return;
    }
    apply(result);
  }

  function confirmRedraw() {
    // Re-run against the LATEST state, not the one Save computed against --
    // a score may have landed in the meantime.
    const result = applyHandGraphEdit(app.state, draftText);
    if (!result.ok) {
      setRedrawPrompt(null);
      setError(result.error);
      return;
    }
    apply(result);
  }

  if (!editing) {
    return (
      <ProgressSubsection title='CUSTOM BRACKET GRAPH'>
        <UpperLowerLiveFields state={state} />
        {success ? (
          <Alert className='mb-3' tone='success'>
            {success}
          </Alert>
        ) : null}
        <WaterfallGraphEditor
          currentRoundLabels={currentRoundLabels}
          entrantCount={entrantCount}
          finalsMatch={finalsMatchOfState(state)}
          firstRoundNumber={firstRoundNumber}
          lockedRounds={lockedRounds}
          onChange={() => {}}
          readOnly
          roomSize={roomSize}
          showColumns={showColumns}
          standingsSource={standingsSource}
          {...sourceProps}
          startedColumns={startedColumns}
          text={savedText(state)}
        />
        <ButtonRow className='mt-3'>
          <Button onClick={startEdit}>Edit graph</Button>
        </ButtonRow>
      </ProgressSubsection>
    );
  }

  return (
    <ProgressSubsection title='CUSTOM BRACKET GRAPH'>
      <Alert className='mb-3' tone='info'>
        {CAUTION_MESSAGE}
      </Alert>
      {state.gamemodeConfig.upperLowerVersion ? (
        <Alert className='mb-3' tone='info'>
          {HAND_EDIT_MESSAGE}
        </Alert>
      ) : null}
      {error ? (
        <Alert className='mb-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <WaterfallGraphEditor
        allowReplace={false}
        currentRoundLabels={currentRoundLabels}
        entrantCount={entrantCount}
        finalsMatch={finalsMatchOfState(state)}
        firstRoundNumber={firstRoundNumber}
        lockedRounds={lockedRounds}
        onChange={(next) => {
          setDraftText(next);
          setRedrawPrompt(null);
        }}
        roomSize={roomSize}
        showColumns={showColumns}
        standingsSource={standingsSource}
        {...sourceProps}
        startedColumns={startedColumns}
        text={draftText}
      />
      {redrawPrompt ? (
        <Alert className='mt-3' tone='danger'>
          <p>
            This re-draws &quot;{redrawPrompt}&quot;&apos;s rooms. Players will be told their new rooms
            through the live Bracket. Continue?
          </p>
          <ButtonRow className='mt-2'>
            <Button onClick={confirmRedraw} variant='danger'>
              Continue
            </Button>
            <Button onClick={() => setRedrawPrompt(null)}>Cancel</Button>
          </ButtonRow>
        </Alert>
      ) : (
        <ButtonRow className='mt-3'>
          <Button onClick={save} variant='primary'>
            Save
          </Button>
          <Button onClick={cancelEdit}>Cancel</Button>
        </ButtonRow>
      )}
    </ProgressSubsection>
  );
}
