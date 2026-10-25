import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { infoWithRoundNote, roundNoteRows, type RoundNoteRow } from '../../domain/tournament/round-notes';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { Textarea } from '../../components/ui';
import { EditingTag } from '../presence/EditingTag';
import { ROUND_NOTE_CONTROL_PREFIX } from '../presence/presence.shared';
import { useTournamentApp } from '../tournament/TournamentProvider';

const HELP = "Shown under each round's title on the Bracket. **bold** works; a new line starts a new line.";
const MAX_NOTE_LENGTH = 160;

function rowName(row: RoundNoteRow): string {
  return row.orphan ? `${row.name} · not in the schedule` : row.name;
}

/** Sizes a textarea to its content, so a longer note grows the box instead of scrolling inside it. */
function useAutoGrow(value: string) {
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [value]);
  return box;
}

/** One round's note: its name, then a one-line box that grows with the text. It is saved when the box is left, like the rules text. */
function RoundNoteRowFields({ row, id }: { row: RoundNoteRow; id: string }) {
  const { updateState, readOnly } = useTournamentApp();
  const [draft, setDraft] = useState(row.note);
  const focused = useRef(false);
  const box = useAutoGrow(draft);
  useEffect(() => {
    if (!focused.current) setDraft(row.note);
  }, [row.note]);
  function save() {
    focused.current = false;
    if (draft.trim() === row.note) return;
    updateState((current) => ({
      ...current,
      info: infoWithRoundNote(current.info ?? createDefaultInfo(), row.name, draft),
    }));
  }
  return (
    <>
      <label className='pt-1.25 text-sm leading-5 font-bold wrap-break-word' htmlFor={id}>
        {rowName(row)}
      </label>
      <Textarea
        className='min-h-8.5 resize-none overflow-hidden py-1 text-sm leading-5'
        disabled={readOnly}
        id={id}
        maxLength={MAX_NOTE_LENGTH}
        onBlur={save}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        placeholder='No specific settings'
        ref={box}
        rows={1}
        value={draft}
      />
    </>
  );
}

/** The settings note of every round of the generated schedule, one compact row each; who else is in any of them shows on the group's title. */
export function RoundNotesField() {
  const { state } = useTournamentApp();
  const rows = roundNoteRows(state, state.info?.roundNotes);
  return (
    <div className='flex flex-col gap-2.5'>
      <div>
        <div className='text-sm font-bold'>
          Round settings
          <EditingTag field='info.roundNotes' />
        </div>
        <p className='mt-1 text-[13px] text-muted'>{HELP}</p>
      </div>
      {rows.length > 0 ? (
        <div className='grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5'>
          {rows.map((row, index) => (
            <RoundNoteRowFields id={`${ROUND_NOTE_CONTROL_PREFIX}${index}`} key={row.name} row={row} />
          ))}
        </div>
      ) : (
        <p className='text-[13px] text-muted'>Generate the schedule to add each round's settings.</p>
      )}
    </div>
  );
}
