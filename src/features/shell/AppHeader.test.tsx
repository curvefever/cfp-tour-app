// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';

afterEach(cleanup);

const tabs = [
  { key: 'tournaments' as const, label: 'Tournaments' },
  { key: 'info' as const, label: 'Info' },
  { key: 'bracket' as const, label: 'Bracket' },
];

function renderHeader(options: { onSelectTab?: () => void; signedIn?: boolean } = {}) {
  return render(
    <AppHeader
      account={options.signedIn ? { name: 'Test Host', role: 'Tour Host', onSignOut: () => undefined } : null}
      activeTab='bracket'
      onHome={() => undefined}
      onSelectTab={options.onSelectTab ?? (() => undefined)}
      tabs={tabs}
      tournamentLoaded
    />,
  );
}

describe('AppHeader on a phone', () => {
  it('lists Tournaments twice, one per breakpoint, both opening the same tab', () => {
    const onSelectTab = vi.fn();
    const view = renderHeader({ onSelectTab });

    const buttons = view.getAllByRole('button', { name: 'Tournaments' });
    expect(buttons).toHaveLength(2);
    const [phone, desktop] = [
      buttons.find((button) => button.className.includes('min-[701px]:hidden')),
      buttons.find((button) => button.className.includes('max-[700px]:hidden')),
    ];
    expect(phone).toBeDefined();
    expect(desktop).toBeDefined();
    expect(phone).not.toBe(desktop);
    expect(view.getByRole('navigation', { name: 'Tournament sections' }).contains(desktop ?? null)).toBe(
      true,
    );
    expect(view.getByRole('navigation', { name: 'Tournament sections' }).contains(phone ?? null)).toBe(false);

    fireEvent.click(phone as HTMLElement);
    fireEvent.click(desktop as HTMLElement);
    expect(onSelectTab.mock.calls).toEqual([['tournaments'], ['tournaments']]);
  });

  it('keeps one app-name button whose accessible name is the long name', () => {
    const view = renderHeader();

    expect(view.getAllByRole('button', { name: 'CFP Tournament Hub' })).toHaveLength(1);
    expect(view.getByText('CFP Tour Hub')).toBeDefined();
  });

  it("labels the signed-in initial with the admin's name and role", () => {
    const view = renderHeader({ signedIn: true });

    expect(view.getByRole('img', { name: 'Signed in as Test Host · Tour Host' }).textContent).toBe('T');
  });
});
