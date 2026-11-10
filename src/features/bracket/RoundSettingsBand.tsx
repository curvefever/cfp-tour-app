import { useState } from 'react';
import { cn } from '../../components/ui';
import type { RoundSettings } from '../../domain/tournament/round-notes';
import { FullSizeImage } from '../info/FullSizeImage';
import { roundNoteLines } from '../info/round-note-lines';
import { Inlines } from '../info/RulesText';
import { ScreenshotThumb } from '../info/ScreenshotThumb';
import { usePopupPin } from './PopupIcon';

/** A band is at least 59 px tall on a wide screen (two lines of note), so short notes keep the rooms level. */
const bandClass = 'rounded-b px-3.5 pt-2.25 pb-2.5 min-[701px]:min-h-14.75';

/** The sliders icon of the round settings: three bars with a knob each. */
export function SlidersIcon({ size = 16, strokeWidth = 1.6 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden='true' fill='none' height={size} viewBox='0 0 16 16' width={size}>
      <g stroke='currentColor' strokeLinecap='round' strokeWidth={strokeWidth}>
        <path d='M2 4H7.2M12.8 4H14M2 8H3.2M8.8 8H14M2 12H8.2M13.8 12H14' />
        <circle cx='10' cy='4' r='1.8' />
        <circle cx='6' cy='8' r='1.8' />
        <circle cx='11' cy='12' r='1.8' />
      </g>
    </svg>
  );
}

/** A settings note's lines, each with the rules text's inline formatting. */
export function RoundNoteLines({ note }: { note: string }) {
  return (
    <div className='min-w-0 wrap-break-word [&_strong]:font-bold [&_strong]:text-white'>
      {roundNoteLines(note).map((parts, index) => (
        <div key={index}>
          <Inlines parts={parts} />
        </div>
      ))}
    </div>
  );
}

/** A settings picture as a small thumbnail at the end of its line; clicking it opens it full size with the box's text under it. */
function SettingsThumb({
  imageId,
  note,
  title,
  tournamentId,
}: {
  imageId: string;
  note: string;
  title: string;
  tournamentId: string;
}) {
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  usePopupPin(openSrc !== null);
  return (
    <>
      <ScreenshotThumb
        alt={`Picture of ${title}`}
        className='h-8 w-13 shrink-0 rounded-xs max-[700px]:h-11 max-[700px]:w-17'
        imageId={imageId}
        onOpen={setOpenSrc}
        tournamentId={tournamentId}
      />
      {openSrc ? (
        <FullSizeImage
          caption={note ? <RoundNoteLines note={note} /> : undefined}
          onClose={() => setOpenSrc(null)}
          src={openSrc}
          title={title}
        />
      ) : null}
    </>
  );
}

/** One line of the settings: an optional label, the note's lines, and the thumbnail of its picture. */
function SettingsLine({
  label,
  note,
  picture,
  title,
  tournamentId,
}: {
  label?: string;
  note: string;
  picture: string | undefined;
  title: string;
  tournamentId: string;
}) {
  return (
    <div className='flex items-start gap-2'>
      {label ? <span className='w-6.5 shrink-0 text-[13px] font-extrabold text-cfp-sky'>{label}</span> : null}
      <div className='min-w-0 flex-1'>{note ? <RoundNoteLines note={note} /> : null}</div>
      {picture && tournamentId ? (
        <SettingsThumb imageId={picture} note={note} title={title} tournamentId={tournamentId} />
      ) : null}
    </div>
  );
}

/**
 * What a round's settings say: the round's own note (and picture), then, under a thin divider, one line per game that
 * has a note or a picture ("G1", "G2"…). `title` is the round's name, which titles a picture's full-size view.
 */
export function RoundSettingsContent({
  settings,
  title,
  tournamentId,
}: {
  settings: RoundSettings;
  title: string;
  tournamentId: string;
}) {
  const hasOwn = settings.note !== '' || settings.picture !== undefined;
  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      {hasOwn ? (
        <SettingsLine
          note={settings.note}
          picture={settings.picture}
          title={title}
          tournamentId={tournamentId}
        />
      ) : null}
      {settings.games.length > 0 ? (
        <div className={cn('flex flex-col gap-1.5', hasOwn && 'mt-2 border-t border-cfp-text-dim/40 pt-2')}>
          {settings.games.map((game) => (
            <SettingsLine
              key={game.label}
              label={game.label}
              note={game.note}
              picture={game.picture}
              title={`${title} · ${game.name}`}
              tournamentId={tournamentId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The round's settings under its title bar, with a sliders icon, or, in a tournament where other rounds have
 * settings, a quiet "No specific settings" (`empty`: the same quiet band with no text, under the standings column's
 * title bar). Each band takes its own height, at least two lines on a wide screen.
 */
export function RoundSettingsBand({
  className,
  empty = false,
  settings,
  title = '',
  tournamentId = '',
}: {
  className?: string;
  empty?: boolean;
  /** `null` for a round with no settings. */
  settings: RoundSettings | null;
  /** The round's name. */
  title?: string;
  /** Where the settings pictures are stored. */
  tournamentId?: string;
}) {
  if (!settings) {
    return (
      <div
        aria-hidden={empty || undefined}
        className={cn(
          bandClass,
          'bg-cfp-game-banner/35 text-[14px] leading-5 text-cfp-text-middle-muted',
          className,
        )}
        data-settings-band
      >
        {empty ? null : 'No specific settings'}
      </div>
    );
  }
  return (
    <div
      aria-label='Round settings'
      className={cn(
        bandClass,
        'flex gap-2.5 bg-cfp-game-banner text-[14px] leading-5 text-cfp-text',
        className,
      )}
      data-settings-band
      role='note'
    >
      <span className='mt-0.5 shrink-0 text-cfp-sky'>
        <SlidersIcon />
      </span>
      <RoundSettingsContent settings={settings} title={title} tournamentId={tournamentId} />
    </div>
  );
}
