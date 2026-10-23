import { useEffect, useRef, useState } from 'react';

/**
 * "Signed in · <role>" in the header: a button that opens a one-item menu to sign out. On a phone the button is a
 * circle with the name's initial instead (CSS only).
 */
export function AccountMenu({
  name,
  role,
  onSignOut,
}: {
  name: string;
  role: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className='relative' ref={container}>
      <button
        aria-expanded={open}
        aria-haspopup='menu'
        className='cursor-pointer rounded px-1.5 py-1 text-[13px] max-[700px]:flex max-[700px]:min-h-11 max-[700px]:min-w-11 max-[700px]:items-center max-[700px]:justify-center whitespace-nowrap text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        onClick={() => setOpen((current) => !current)}
      >
        <span className='max-[700px]:hidden'>Signed in{role ? ` · ${role}` : ''}</span>
        <span
          aria-label={`Signed in as ${name}${role ? ` · ${role}` : ''}`}
          className='flex size-7.5 items-center justify-center rounded-full bg-surface-hover text-sm font-bold text-foreground uppercase min-[701px]:hidden'
          role='img'
        >
          {name.trim().charAt(0)}
        </span>
      </button>
      {open ? (
        <div
          className='absolute top-full right-0 z-10 mt-1 min-w-44 rounded-md border border-surface-hover bg-surface p-1 shadow-[0_10px_30px_var(--shadow-floating)]'
          role='menu'
        >
          <button
            autoFocus
            className='w-full cursor-pointer rounded px-3 py-2 text-left text-sm font-semibold text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            role='menuitem'
          >
            Sign out ({name})
          </button>
        </div>
      ) : null}
    </div>
  );
}
