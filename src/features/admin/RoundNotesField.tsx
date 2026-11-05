import { useState } from 'react';
import {
  gameNoteRowLabel,
  infoWithGameNote,
  infoWithRoundNote,
  roundNoteRowLabel,
  roundNoteRows,
  type GameNoteRow,
  type RoundNoteRow,
} from '../../domain/tournament/round-notes';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import type { TournamentInfo } from '../../domain/tournament/types';
import { Alert } from '../../components/ui';
import { RoundNoteLines } from '../bracket/RoundSettingsBand';
import { EditingTag } from '../presence/EditingTag';
import { ROUND_NOTE_CONTROL_PREFIX } from '../presence/presence.shared';
import { MAX_NOTE_PICTURES, notePictureCount, notePicturesOf } from '../tournaments/note-pictures.shared';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { NotePictureControl } from './NotePictureControl';
import { NoteTextarea } from './NoteTextarea';

const HELP =
  "Shown under each round's title on the Bracket. **bold** works; a new line starts a new line. A round of several games has a box per game; a picture opens full size when clicked.";

/** A settings box: its text, saved when the box is left, and its picture. A failed picture change shows under the box. */
function NoteBox({
  id,
  note,
  onSave,
  picture,
  roundName,
  slot,
  title,
}: {
  id: string;
  note: string;
  onSave: (text: string) => void;
  picture: string | undefined;
  roundName: string;
  slot: string;
  title: string;
}) {
  const [error, setError] = useState('');
  return (
    <div className='min-w-0'>
      <div className='flex flex-wrap items-start gap-2'>
        <NoteTextarea className='min-w-48 flex-1' id={id} note={note} onSave={onSave} />
        <NotePictureControl
          caption={note ? <RoundNoteLines note={note} /> : undefined}
          imageId={picture}
          onError={setError}
          roundName={roundName}
          slot={slot}
          title={title}
        />
      </div>
      {error ? (
        <Alert className='mt-1' tone='danger'>
          {error}
        </Alert>
      ) : null}
    </div>
  );
}

function GameNoteRowFields({ game, id, row }: { game: GameNoteRow; id: string; row: RoundNoteRow }) {
  const { updateState } = useTournamentApp();
  function save(text: string) {
    updateState((current) => ({
      ...current,
      info: infoWithGameNote(current.info ?? createDefaultInfo(), row.name, game.key, text),
    }));
  }
  return (
    <>
      <label className='pt-1.25 text-right text-[13px] leading-5 text-muted wrap-break-word' htmlFor={id}>
        {gameNoteRowLabel(game)}
      </label>
      <NoteBox
        id={id}
        note={game.note}
        onSave={save}
        picture={game.picture}
        roundName={row.name}
        slot={game.key}
        title={`${row.shown ?? row.name} · ${game.label}`}
      />
    </>
  );
}

/** One round's note and picture, then a box per game of a round that plays several. */
function RoundNoteRowFields({ row, id }: { row: RoundNoteRow; id: string }) {
  const { updateState } = useTournamentApp();
  function save(text: string) {
    updateState((current) => ({
      ...current,
      info: infoWithRoundNote(current.info ?? createDefaultInfo(), row.name, text),
    }));
  }
  return (
    <>
      <label className='pt-1.25 text-sm leading-5 font-bold wrap-break-word' htmlFor={id}>
        {roundNoteRowLabel(row)}
      </label>
      <NoteBox
        id={id}
        note={row.note}
        onSave={save}
        picture={row.picture}
        roundName={row.name}
        slot='round'
        title={row.shown ?? row.name}
      />
      {row.games.map((game) => (
        <GameNoteRowFields game={game} id={`${id}-${game.key}`} key={game.key} row={row} />
      ))}
    </>
  );
}

function picturesUsed(info: TournamentInfo | undefined): number {
  return notePictureCount(notePicturesOf(info?.notePictures));
}

/**
 * The settings of every round of the generated schedule, one compact row each, with a row per game under a round of
 * several games; who else is in any of them shows on the group's title.
 */
export function RoundNotesField() {
  const { state } = useTournamentApp();
  const rows = roundNoteRows(state, state.info);
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
        <>
          <div className='grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5'>
            {rows.map((row, index) => (
              <RoundNoteRowFields id={`${ROUND_NOTE_CONTROL_PREFIX}${index}`} key={row.name} row={row} />
            ))}
          </div>
          <p className='text-xs text-muted'>
            {picturesUsed(state.info)} of {MAX_NOTE_PICTURES} settings pictures used
          </p>
        </>
      ) : (
        <p className='text-[13px] text-muted'>Generate the schedule to add each round's settings.</p>
      )}
    </div>
  );
}
