// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoundSettings } from '../../domain/tournament/round-notes';
import { cacheScreenshot } from '../info/screenshot-cache';
import { RoundSettingsBand } from './RoundSettingsBand';
import { RoundSettingsPopup } from './RoundSettingsPopup';

window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

const IMAGE = 'data:image/webp;base64,AAAA';

beforeEach(() => {
  // Pictures are read from the browser's cache first: the test seeds it, so no database is asked.
  for (const id of ['picRound01', 'picGame001', 'picGame002']) {
    cacheScreenshot(window.localStorage, id, IMAGE);
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const band = (settings: RoundSettings | null, extra: { empty?: boolean; tournamentId?: string } = {}) =>
  render(<RoundSettingsBand settings={settings} title='Final' tournamentId='t1' {...extra} />);

describe('RoundSettingsBand', () => {
  it('is a quiet "No specific settings" for a round with nothing, and silent when empty', () => {
    expect(band(null).getByText('No specific settings')).toBeTruthy();
    cleanup();
    expect(band(null, { empty: true }).container.textContent).toBe('');
  });

  it("shows the round's note alone, with no divider and no game lines", () => {
    const view = band({ note: 'Target score: **120**', games: [] });
    expect(view.getByText('120').tagName).toBe('STRONG');
    expect(view.container.querySelector('.border-t')).toBeNull();
    expect(view.queryByText(/^G\d$/)).toBeNull();
  });

  it('lists the games with something, in order, under a divider below the round note', () => {
    const view = band({
      note: 'Powers: Ghost',
      games: [
        { label: 'G1', note: 'Zap only' },
        { label: 'G3', note: 'No powers\nSmall map' },
      ],
    });
    const lines = [...view.container.querySelectorAll('.border-t > div')].map((line) => line.textContent);
    expect(lines).toEqual(['G1Zap only', 'G3No powersSmall map']);
    expect(view.container.querySelector('.border-t')).not.toBeNull();
    expect(view.queryByText('G2')).toBeNull();
  });

  it('shows the games with no divider when the round has no note of its own', () => {
    const view = band({ note: '', games: [{ label: 'G2', note: 'Zap only' }] });
    expect(view.getByText('G2')).toBeTruthy();
    expect(view.container.querySelector('.border-t')).toBeNull();
  });

  it("shows the thumbnail of a picture-only game, and the round's own picture", () => {
    const view = band({
      note: '',
      picture: 'picRound01',
      games: [{ label: 'G2', note: '', picture: 'picGame002' }],
    });
    expect(view.getByAltText('Picture of Final')).toBeTruthy();
    expect(view.getByAltText('Picture of Final · Game 2')).toBeTruthy();
    expect(view.getByText('G2')).toBeTruthy();
  });

  it('shows no thumbnail without a tournament to read it from', () => {
    const view = band({ note: 'x', picture: 'picRound01', games: [] }, { tournamentId: '' });
    expect(view.container.querySelector('img')).toBeNull();
  });

  it("opens a picture full size, titled with the round and game and captioned with the box's text", () => {
    const view = band({ note: '', games: [{ label: 'G1', note: 'Zap **only**', picture: 'picGame001' }] });
    expect(view.queryByRole('dialog')).toBeNull();
    fireEvent.click(view.getByAltText('Picture of Final · Game 1'));
    const dialog = view.getByRole('dialog');
    expect(dialog.textContent).toContain('Final · Game 1');
    expect(dialog.textContent).toContain('Zap only');
    expect(view.getByAltText('Final · Game 1, full size')).toBeTruthy();
    fireEvent.click(view.getByText('Close'));
    expect(view.queryByRole('dialog')).toBeNull();
  });
});

describe('RoundSettingsPopup', () => {
  it('shows the same lines in the pop-up of the title bar button', () => {
    const view = render(
      <RoundSettingsPopup
        settings={{ note: 'Powers: Ghost', games: [{ label: 'G2', note: 'Zap only' }] }}
        title='Final'
        tournamentId='t1'
      />,
    );
    expect(view.queryByText('Powers: Ghost')).toBeNull();
    fireEvent.focus(view.getByRole('button', { name: 'Round settings' }));
    expect(view.getByText('Powers: Ghost')).toBeTruthy();
    expect(view.getByText('G2')).toBeTruthy();
    expect(view.getByText('Zap only')).toBeTruthy();
  });
  it('stays open while a picture is shown full size, in the page body, and Escape closes the view first', () => {
    const view = render(
      <RoundSettingsPopup
        settings={{ note: 'Powers: Ghost', games: [{ label: 'G1', note: '', picture: 'picGame001' }] }}
        title='Final'
        tournamentId='t1'
      />,
    );
    const button = view.getByRole('button', { name: 'Round settings' });
    fireEvent.focus(button);
    fireEvent.click(view.getByAltText('Picture of Final · Game 1'));
    const dialog = view.getByRole('dialog');
    expect(dialog.closest('[role="tooltip"]')).toBeNull();
    expect(document.body.contains(dialog)).toBe(true);

    // The focus moving into the full-size view, or the mouse leaving the pop-up, does not close the pop-up under it.
    fireEvent.blur(button, { relatedTarget: dialog });
    fireEvent.mouseLeave(button.parentElement as HTMLElement);
    expect(view.getByRole('tooltip')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog')).toBeNull();
    // Nothing hovers the pop-up any more, so it closes with the view it was holding open.
    expect(view.queryByRole('tooltip')).toBeNull();
  });
});
