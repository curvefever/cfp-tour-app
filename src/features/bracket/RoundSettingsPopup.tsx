import type { RoundSettings } from '../../domain/tournament/round-notes';
import { PopupIcon } from './PopupIcon';
import { RoundSettingsContent, SlidersIcon } from './RoundSettingsBand';

/**
 * The title bar's sliders button, shown on a round with settings while the Bracket hides the round settings bands:
 * it opens the settings in a pop-up, the way the exit icon opens its lines. Like the fold chevron beside it, it
 * has no background of its own and takes the bar's text colour.
 */
export function RoundSettingsPopup({
  settings,
  title,
  tournamentId,
}: {
  settings: RoundSettings;
  title: string;
  tournamentId: string;
}) {
  return (
    <PopupIcon
      buttonClassName='size-7 max-[700px]:size-11'
      containerClassName='relative'
      icon={<SlidersIcon size={18} strokeWidth={1.7} />}
      label='Round settings'
      popupClassName='top-full right-0 mt-1 w-72 max-w-[calc(100vw-40px)] bg-cfp-game-banner px-3.5 py-2.5 text-[14px] leading-5 whitespace-normal text-cfp-text outline-0 border border-cfp-brand'
    >
      {(touch) => (
        <div className={touch ? 'pr-8' : undefined}>
          <div className='flex'>
            <RoundSettingsContent settings={settings} title={title} tournamentId={tournamentId} />
          </div>
        </div>
      )}
    </PopupIcon>
  );
}
