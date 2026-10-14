import { useEffect, useRef, useState } from 'react';

/** "Signed in · <role>" in the header: a button that opens a one-item menu to sign out. */
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
        className='cursor-pointer rounded px-1.5 py-1 text-[13px] whitespace-nowrap text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        onClick={() => setOpen((current) => !current)}
      >
        Signed in{role ? ` · ${role}` : ''}
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
