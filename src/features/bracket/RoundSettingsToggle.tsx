import { cn } from '../../components/ui';
import { SlidersIcon } from './RoundSettingsBand';

/** The sliders icon at the right of the follow row: shows or hides the round settings bands of the Bracket. */
export function RoundSettingsToggle({ shown, onToggle }: { shown: boolean; onToggle(): void }) {
  const title = shown ? 'Hide round settings' : 'Show round settings';
  return (
    <button
      aria-label='Round settings'
      aria-pressed={shown}
      className={cn(
        'flex size-11 cursor-pointer items-center justify-center hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
        shown ? 'text-cfp-sky' : 'text-muted',
      )}
      onClick={onToggle}
      title={title}
      type='button'
    >
      <SlidersIcon size={28} strokeWidth={1.25} />
    </button>
  );
}
