import { Button } from '../../components/ui';

/**
 * The band under the tab bar while an admin looks at the pages as a viewer sees them: it says why the admin tools are
 * gone and keeps the way back in view on every tab. One line, also on a phone.
 */
export function SpectatorBand({ onBack }: { onBack: () => void }) {
  return (
    <div
      className='border-b border-cfp-mid-header-border bg-surface px-6 max-[700px]:px-3.5'
      data-look='middle'
      role='status'
    >
      <div className='mx-auto flex max-w-310 items-center justify-between gap-3 py-1.5'>
        <span className='min-w-0 truncate text-[13px] font-semibold text-muted'>
          Spectator view: what viewers see.
        </span>
        <Button className='shrink-0 px-3' onClick={onBack} size='sm'>
          Back to admin view
        </Button>
      </div>
    </div>
  );
}
