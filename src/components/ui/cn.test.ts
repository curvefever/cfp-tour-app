import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('drops falsy values', () => {
    expect(cn('a', false, 'b', null, undefined, '')).toBe('a b');
  });

  it('a later conflicting width class wins', () => {
    expect(cn('w-full', 'w-22.5', 'w-13')).toBe('w-13');
  });

  it('a later conflicting text-transform class wins', () => {
    expect(cn('uppercase', 'normal-case')).toBe('normal-case');
  });

  it('a later conflicting letter-spacing class wins', () => {
    expect(cn('tracking-[0.08em]', 'tracking-normal')).toBe('tracking-normal');
  });

  it('a later conflicting white-space class wins', () => {
    expect(cn('whitespace-nowrap', 'whitespace-normal')).toBe('whitespace-normal');
  });

  it('a later conflicting font-size class wins', () => {
    expect(cn('text-xs', 'text-[0.62rem]')).toBe('text-[0.62rem]');
  });

  it('keeps a custom colour next to a font size -- not the same conflict group', () => {
    expect(cn('text-muted', 'text-xs')).toBe('text-muted text-xs');
  });

  it('keeps a border-width utility next to a border-colour class -- different conflict groups', () => {
    // The real bracketRowBase pattern (BracketView.tsx): 'border-l-[3px]
    // border-l-transparent', width and colour both prefixed border-l-.
    expect(cn('border-l-[3px]', 'border-l-success')).toBe('border-l-[3px] border-l-success');
  });

  it("a later border-l colour wins over the caller's own default, matching bracketRowBase + resultClasses", () => {
    // border-* and border-l-* colours ARE the same conflict group in
    // tailwind-merge (verified directly against the installed package, not
    // assumed) -- this is the exact real-world case the whole fix targets:
    // bracketRowBase's own 'border-l-transparent' default losing cleanly to
    // a caller's real result colour instead of surviving in the DOM
    // alongside it and depending on stylesheet order.
    expect(cn('border-l-transparent', 'border-l-success')).toBe('border-l-success');
  });

  it('keeps non-conflicting classes from unrelated groups', () => {
    expect(cn('mb-2', 'rounded-md', 'px-1.5')).toBe('mb-2 rounded-md px-1.5');
  });
});
