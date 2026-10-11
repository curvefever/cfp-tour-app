import { useState } from 'react';
import { rosterKeys } from '../../../domain/tournament/roster';
import type { TournamentState } from '../../../domain/tournament/types';
import {
  serializeWaterfallDraft,
  waterfallDraftFromRounds,
} from '../../../domain/tournament/waterfall-draft';
import {
  applyWaterfallGraphEdit,
  type WaterfallGraphEditResult,
} from '../../../domain/tournament/waterfall-live-edit';
import { Alert, Button, ButtonRow, Panel, PanelTitle } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';

const CAUTION_MESSAGE =
  "The tournament is running. Rounds that have started keep their rooms; you can still change where their players go next. Saving re-sorts players using the results already entered. If the current round's line-up changes, its rooms are re-drawn, which is only possible before any score is entered there.";

/** Labels of every reached waterfall round (index <= curRound), and which one is current. */
function reachedRounds(state: TournamentState): { lockedRounds: Set<string>; currentRoundLabel?: string } {
  const lockedRounds = new Set<string>();
  let currentRoundLabel: string | undefined;
  state.rounds.forEach((round, index) => {
    if (!round.isWaterfall || index > state.curRound || !round.customLabel) return;
    lockedRounds.add(round.customLabel);
    if (index === state.curRound) currentRoundLabel = round.customLabel;
  });
  return { lockedRounds, currentRoundLabel };
}

/** A qualification-table graph has a Qual source and is checked against the units still registered, not the entry round's size. */
function hasStandingsSource(state: TournamentState): boolean {
  return state.cfg.poolingPhase === 'qual-table' && state.rounds.some((round) => round.isQual);
}

function savedText(state: TournamentState): string {
  const rankCount = rosterKeys(state.players).length;
  return serializeWaterfallDraft(waterfallDraftFromRounds(state.rounds, { rankCount }));
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
  const standingsSource = hasStandingsSource(state);
  const entrantCount = standingsSource ? rosterKeys(state.players).length : (entryRound?.players ?? null);
  const { lockedRounds, currentRoundLabel } = reachedRounds(state);

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
    const result = applyWaterfallGraphEdit(app.state, draftText);
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
    const result = applyWaterfallGraphEdit(app.state, draftText);
    if (!result.ok) {
      setRedrawPrompt(null);
      setError(result.error);
      return;
    }
    apply(result);
  }

  if (!editing) {
    return (
      <Panel>
        <PanelTitle>Waterfall bracket graph</PanelTitle>
        {success ? (
          <Alert className='mb-3' tone='success'>
            {success}
          </Alert>
        ) : null}
        <WaterfallGraphEditor
          currentRoundLabel={currentRoundLabel}
          entrantCount={entrantCount}
          lockedRounds={lockedRounds}
          onChange={() => {}}
          readOnly
          roomSize={roomSize}
          standingsSource={standingsSource}
          text={savedText(state)}
        />
        <ButtonRow className='mt-3'>
          <Button onClick={startEdit}>Edit graph</Button>
        </ButtonRow>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>Waterfall bracket graph</PanelTitle>
      <Alert className='mb-3' tone='info'>
        {CAUTION_MESSAGE}
      </Alert>
      {error ? (
        <Alert className='mb-3' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <WaterfallGraphEditor
        allowReplace={false}
        currentRoundLabel={currentRoundLabel}
        entrantCount={entrantCount}
        lockedRounds={lockedRounds}
        onChange={(next) => {
          setDraftText(next);
          setRedrawPrompt(null);
        }}
        roomSize={roomSize}
        standingsSource={standingsSource}
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
    </Panel>
  );
}
