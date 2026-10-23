import { useState } from 'react';
import { Button, Textarea, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { PanelCloseButton } from './PanelCloseButton';
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
        'flex size-11 cursor-pointer items-center justify-center hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
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
 * The notes of the tournament, newest first, in a panel under the follow row. Admins add and delete them, during
 * the tournament and after it has finished (the one thing a finished tournament still takes); viewers only read
 * them.
 */
export function AnnotationsPanel({ onClose }: { onClose(): void }) {
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
    <div
      aria-label='Notes'
      className='absolute top-14 right-0 z-20 flex w-100 max-w-[calc(100vw-40px)] flex-col gap-3 rounded-xs bg-cfp-game-deep px-4.5 py-4 shadow-[0_14px_40px_var(--shadow-floating)] outline-2 outline-primary'
      role='dialog'
    >
      <div className='flex items-center justify-between'>
        <h2 className='text-[15px] font-extrabold tracking-[0.04em] uppercase'>Notes</h2>
        <PanelCloseButton onClose={onClose} />
      </div>
      {!annotations.length ? <p className='text-sm text-muted'>No notes yet.</p> : null}
      {annotationsNewestFirst(annotations).map((entry) => (
        <div
          className='flex gap-2.5 rounded-xs bg-surface px-3 py-2.5'
          key={`${entry.timestamp}-${entry.position}`}
        >
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <div className='text-[15px] leading-normal whitespace-pre-wrap [overflow-wrap:anywhere]'>
              {entry.text}
            </div>
            <div className='text-xs text-muted'>{new Date(entry.timestamp).toLocaleString()}</div>
          </div>
          {canEdit ? (
            <button
              aria-label='Delete note'
              className='size-6.5 shrink-0 cursor-pointer text-sm text-cfp-danger-text'
              onClick={() => remove(entry.position)}
              type='button'
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div className='flex flex-col gap-2 border-t border-cfp-game-fold pt-3'>
          <label className='text-[13px] font-bold text-muted' htmlFor='annotation-input'>
            Add a note
          </label>
          <Textarea
            className='min-h-16 rounded-xs border-2 border-cfp-game-frame bg-cfp-game-title text-sm'
            id='annotation-input'
            maxLength={MAX_ANNOTATION_CHARS}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
          <Button className='self-end' disabled={!note.trim()} onClick={add} size='sm' variant='primary'>
            Add note
          </Button>
        </div>
      ) : null}
    </div>
  );
}
