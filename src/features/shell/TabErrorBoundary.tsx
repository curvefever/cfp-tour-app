import { Component, type ReactNode } from 'react';
import { Alert, Button } from '../../components/ui';

interface Props {
  /** Admins see the error's message too, to report it. */
  isAdmin: boolean;
  children: ReactNode;
}

interface State {
  error: unknown;
}

const NO_ERROR = Symbol('no error');

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * Keeps a render error in one tab's content from blanking the whole page: the header and tab bar stay outside it, so
 * the user can switch tab. `isAdmin` is a prop, not read from context, so the fallback cannot fail on a broken context.
 */
export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: NO_ERROR };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (error === NO_ERROR) return this.props.children;
    return (
      <Alert role='alert' tone='danger'>
        <p className='font-bold'>This page couldn&apos;t be shown.</p>
        <p>Try another tab, or reload the page.</p>
        {this.props.isAdmin ? <p className='mt-1 text-xs text-muted'>{messageOf(error)}</p> : null}
        <Button className='mt-3' onClick={() => window.location.reload()} size='sm'>
          Reload
        </Button>
      </Alert>
    );
  }
}
