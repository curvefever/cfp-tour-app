export function HomeView({ signedIn, onLogIn }: { signedIn: boolean; onLogIn: () => void }) {
  if (signedIn) return null;
  return (
    <button
      className='fixed right-4 bottom-4 cursor-pointer text-xs text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
      onClick={onLogIn}
    >
      Log in as admin
    </button>
  );
}
