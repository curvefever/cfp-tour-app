import { PopupIcon } from './PopupIcon';
import { RoundNoteLines, SlidersIcon } from './RoundSettingsBand';

/**
 * The title bar's sliders button, shown on a round with a note while the Bracket hides the round settings bands:
 * it opens the note's lines in a pop-up, the way the exit icon opens its lines.
 */
export function RoundSettingsPopup({ note }: { note: string }) {
  return (
    <PopupIcon
      buttonClassName='size-8 rounded-xs bg-cfp-game-banner text-cfp-sky max-[700px]:size-11'
      containerClassName='relative mr-1'
      icon={<SlidersIcon size={18} strokeWidth={1.5} />}
      label='Round settings'
      popupClassName='top-full right-0 mt-1 w-72 max-w-[calc(100vw-40px)] bg-cfp-game-banner px-3.5 py-2.5 text-[14px] leading-5 whitespace-normal text-cfp-text outline-0 border border-cfp-brand'
    >
      {(touch) => (
        <div className={touch ? 'pr-8' : undefined}>
          <RoundNoteLines note={note} />
        </div>
      )}
    </PopupIcon>
  );
}
