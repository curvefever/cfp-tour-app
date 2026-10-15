import { editingText } from './presence.shared';
import { usePresence } from './PresenceProvider';

/** A small "Alex is editing" next to a field another admin is in; nothing when nobody is. */
export function EditingTag({ field }: { field: string }) {
  const names = usePresence().editors[field];
  if (!names?.length) return null;
  return (
    <span className='ml-2 rounded-full bg-cfp-editing/18 px-2 py-0.5 text-xs font-bold tracking-normal text-cfp-editing-text normal-case'>
      {editingText(names)}
    </span>
  );
}
