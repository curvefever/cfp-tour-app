// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFlushAfterSignInAgain } from './useFlushAfterSignInAgain';

function setup(expired: boolean, canAdmin: boolean) {
  const flush = vi.fn();
  const view = renderHook(
    (props: { expired: boolean; canAdmin: boolean }) =>
      useFlushAfterSignInAgain(props.expired, props.canAdmin, flush),
    { initialProps: { expired, canAdmin } },
  );
  return { flush, view };
}

describe('useFlushAfterSignInAgain', () => {
  it('flushes when the expiry ends and the tab is still an admin tab', () => {
    const { flush, view } = setup(true, true);
    expect(flush).not.toHaveBeenCalled();
    view.rerender({ expired: false, canAdmin: true });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does not flush when the expiry ends because the admin signed out', () => {
    const { flush, view } = setup(true, true);
    view.rerender({ expired: false, canAdmin: false });
    expect(flush).not.toHaveBeenCalled();
  });

  it('does not flush on mount, or while nothing has expired', () => {
    const { flush, view } = setup(false, true);
    view.rerender({ expired: false, canAdmin: true });
    expect(flush).not.toHaveBeenCalled();
  });

  it('flushes again after a second expiry', () => {
    const { flush, view } = setup(true, true);
    view.rerender({ expired: false, canAdmin: true });
    view.rerender({ expired: true, canAdmin: true });
    view.rerender({ expired: false, canAdmin: true });
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
