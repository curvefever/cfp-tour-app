import { Alert, Button } from '../../components/ui';

/** Shown to an admin whose tab was loaded before the live build: the server refuses its writes until it reloads. */
export function NewVersionBanner() {
  return (
    <Alert
      className='mx-auto mt-2.5 flex w-[min(1100px,calc(100%-24px))] flex-wrap items-center gap-x-3 gap-y-2'
      role='alert'
      tone='danger'
    >
      <span>A new version is live — reload to keep editing.</span>
      <Button className='ml-auto' onClick={() => window.location.reload()} size='sm' variant='danger'>
        Reload
      </Button>
    </Alert>
  );
}
