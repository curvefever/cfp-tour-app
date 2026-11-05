import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Textarea } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

/** The most characters a settings note holds, a round's or a game's. */
export const MAX_NOTE_LENGTH = 160;

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

/** One settings note: a one-line box that grows with the text. It is saved when the box is left, like the rules text. */
export function NoteTextarea({
  className,
  id,
  note,
  onSave,
}: {
  className?: string;
  id: string;
  /** The stored text. */
  note: string;
  onSave: (text: string) => void;
}) {
  const { readOnly } = useTournamentApp();
  const [draft, setDraft] = useState(note);
  const focused = useRef(false);
  const box = useAutoGrow(draft);
  useEffect(() => {
    if (!focused.current) setDraft(note);
  }, [note]);
  function save() {
    focused.current = false;
    if (draft.trim() !== note) onSave(draft);
  }
  return (
    <Textarea
      className={`min-h-8.5 resize-none overflow-hidden py-1 text-sm leading-5 ${className ?? ''}`}
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
  );
}
