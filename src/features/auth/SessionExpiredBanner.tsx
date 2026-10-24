import { Alert, Button } from '../../components/ui';

/** Shown to an admin whose CFP session ended: edits are kept in the tab and go out after signing in again. */
export function SessionExpiredBanner({ onSignIn }: { onSignIn(): void }) {
  return (
    <Alert
      className='mx-auto mt-2.5 flex w-[min(1100px,calc(100%-24px))] flex-wrap items-center gap-x-3 gap-y-2'
      role='alert'
      tone='danger'
    >
      <span>Your CFP session has expired — sign in again to keep editing. Your changes are kept.</span>
      <Button className='ml-auto' onClick={onSignIn} size='sm' variant='danger'>
        Sign in
      </Button>
    </Alert>
  );
}
