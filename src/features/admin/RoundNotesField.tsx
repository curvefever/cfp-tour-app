import { useEffect, useRef, useState } from 'react';
import {
  roundNoteRows,
  setRoundNote,
  type RoundNoteRow,
  type RoundNoteSetup,
} from '../../domain/tournament/round-notes';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { Textarea } from '../../components/ui';
import { EditingTag } from '../presence/EditingTag';
import { ROUND_NOTE_CONTROL_PREFIX } from '../presence/presence.shared';
import { useTournamentApp } from '../tournament/TournamentProvider';

const HELP =
  "Shown under the round's title on the Bracket. Up to 3 short lines; **bold** works. Saved when you leave the box.";
const MAX_NOTE_LENGTH = 160;

function rowName(row: RoundNoteRow): string {
  return row.orphan ? `${row.name} · not in the graph` : row.name;
}

/** One note, typed here and saved when the box is left, like the rules text. */
function RoundNoteBox({ row, id }: { row: RoundNoteRow; id: string }) {
  const { updateState, readOnly } = useTournamentApp();
  const [draft, setDraft] = useState(row.note);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(row.note);
  }, [row.note]);
  function save() {
    focused.current = false;
    if (draft.trim() === row.note) return;
    updateState((current) => {
      const { roundNotes: previous, ...info } = current.info ?? createDefaultInfo();
      const roundNotes = setRoundNote(previous, row.key, draft);
      return { ...current, info: { ...info, ...(roundNotes ? { roundNotes } : {}) } };
    });
  }
  return (
    <div>
      <label className='block text-sm font-bold' htmlFor={id}>
        {rowName(row)}
      </label>
      {row.hint ? <p className='mb-1 text-[13px] text-muted'>{row.hint}</p> : null}
      <Textarea
        className='min-h-0 text-sm leading-normal'
        disabled={readOnly}
        id={id}
        maxLength={MAX_NOTE_LENGTH}
        onBlur={save}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        placeholder='Target score: high'
        rows={3}
        value={draft}
      />
    </div>
  );
}

/** The settings notes of the stages (and, in a waterfall, of its rounds), one box each; who else is in any of them shows on the group's title. */
export function RoundNotesField({ setup }: { setup: RoundNoteSetup }) {
  const { state } = useTournamentApp();
  const rows = roundNoteRows(setup, state.info?.roundNotes);
  const graphMissing =
    setup.scheduleLogic === 'waterfall-bracket' && !rows.some((row) => row.key.kind === 'round');
  return (
    <div className='flex flex-col gap-3'>
      <div>
        <div className='text-sm font-bold'>
          Round settings
          <EditingTag field='info.roundNotes' />
        </div>
        <p className='mt-1 text-[13px] text-muted'>{HELP}</p>
      </div>
      {rows.map((row, index) => (
        <RoundNoteBox id={`${ROUND_NOTE_CONTROL_PREFIX}${index}`} key={JSON.stringify(row.key)} row={row} />
      ))}
      {graphMissing ? (
        <p className='text-[13px] text-muted'>Fix the bracket graph to add notes to its rounds.</p>
      ) : null}
    </div>
  );
}
