import { useState } from 'react';
import { Button, Panel, PanelTitle, Textarea, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import {
  addAnnotation,
  annotationsNewestFirst,
  MAX_ANNOTATION_CHARS,
  removeAnnotation,
} from '../tournaments/annotations';

/** Whether this visitor sees the notes: an admin always (to add), a viewer only when there are some. */
function useCanSeeNotes(): boolean {
  const app = useTournamentApp();
  return (app.unlocked && !app.isViewer) || (app.state.annotations ?? []).length > 0;
}

/** The discreet notes icon of the follow row. */
export function AnnotationsToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  const visible = useCanSeeNotes();
  if (!visible) return null;
  return (
    <button
      aria-expanded={open}
      aria-label='Notes about this tournament'
      className={cn(
        'ml-auto flex size-11 cursor-pointer items-center justify-center hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
        open ? 'text-cfp-sky' : 'text-muted',
      )}
      onClick={onToggle}
      title='Notes about this tournament'
      type='button'
    >
      <svg aria-hidden='true' height='28' viewBox='0 0 28 28' width='28'>
        <rect
          fill='none'
          height='21'
          rx='2.5'
          stroke='currentColor'
          strokeWidth='2.2'
          width='17'
          x='5.5'
          y='3.5'
        />
        <path
          d='M9.5 10 H18.5 M9.5 14 H18.5 M9.5 18 H15'
          stroke='currentColor'
          strokeLinecap='round'
          strokeWidth='2.2'
        />
      </svg>
    </button>
  );
}

/**
 * The notes of the tournament, newest first. Admins add and delete them, during the tournament and after it has
 * finished (the one thing a finished tournament still takes); viewers only read them.
 */
export function AnnotationsPanel() {
  const app = useTournamentApp();
  const [note, setNote] = useState('');
  const canEdit = app.unlocked && !app.isViewer;
  const annotations = app.state.annotations ?? [];

  function add() {
    const timestamp = new Date(app.runtime.clock.now()).toISOString();
    app.updateState((current) => ({
      ...current,
      annotations: addAnnotation(current.annotations ?? [], note, timestamp),
    }));
    setNote('');
  }

  function remove(position: number) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    app.updateState((current) => ({
      ...current,
      annotations: removeAnnotation(current.annotations ?? [], position),
    }));
  }

  return (
    <Panel className='mb-2.5'>
      <PanelTitle>Notes</PanelTitle>
      {!annotations.length ? <p className='text-xs text-muted'>No notes yet.</p> : null}
      {annotationsNewestFirst(annotations).map((entry) => (
        <div
          className='mb-2 flex min-w-0 flex-col items-start gap-2 whitespace-pre-wrap rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2'
          key={`${entry.timestamp}-${entry.position}`}
        >
          <div className='flex w-full items-start justify-between gap-2.5 text-sm'>
            <div>{entry.text}</div>
            {canEdit ? (
              <Button size='sm' title='Delete' onClick={() => remove(entry.position)}>
                ✕
              </Button>
            ) : null}
          </div>
          <small className='text-[0.68rem] text-muted'>{new Date(entry.timestamp).toLocaleString()}</small>
        </div>
      ))}
      {canEdit ? (
        <div className='flex items-start gap-2 max-[700px]:flex-col'>
          <Textarea
            className='min-h-19 flex-1 max-[700px]:w-full'
            id='annotation-input'
            maxLength={MAX_ANNOTATION_CHARS}
            value={note}
            placeholder='Add a note about this tournament…'
            onChange={(event) => setNote(event.target.value)}
          />
          <Button disabled={!note.trim()} onClick={add}>
            Add note
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
