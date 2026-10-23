import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  fixtureTournaments,
  fixtureIndexEntry,
  STANDINGS_TABS,
  storedState,
  tournamentListIndex,
  type FixtureTournament,
} from './fixtures';

/**
 * Screenshot spec for the visual redesign: opens each fixture tournament as a signed-out viewer and saves a
 * full-page PNG of every viewer tab, desktop and phone, to `e2e-screens/<fixture>/<tab>-<width>.png`, next to
 * the design boards they are compared with. The database is replaced by the page's test hooks, so no real
 * tournament id is ever opened. Run with `pnpm run test:screens`.
 */

const WIDTHS = [1280, 390] as const;
const OUTPUT_DIR = 'e2e-screens';

// A bright, recognisable picture standing in for a lobby screenshot (the page reads it from the browser cache).
const LOBBY_COLOURS = ['#e8b923', '#48e271', '#e0353d', '#6ed2ff', '#9b6be0', '#fc8a14'];

function lobbyPicture(seed: number): string {
  const slots = LOBBY_COLOURS.map(
    (colour, index) =>
      `<rect x="${40 + index * 96}" y="${150 + ((index + seed) % 2) * 40}" width="80" height="110" rx="8" fill="${colour}"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#0f1a2b"/><rect width="640" height="60" fill="${LOBBY_COLOURS[seed % LOBBY_COLOURS.length]}"/>${slots}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

interface ServedPage {
  index: Record<string, unknown>;
  stored: Record<string, unknown>;
  screenshots: Record<string, string>;
}

/** Stands in for the database: the tournament list, each stored tournament and the cached lobby screenshots. */
async function serve(page: Page, served: ServedPage): Promise<void> {
  await page.addInitScript(({ index, stored, screenshots }) => {
    window.__CURVE_TOUR_INDEX__ = index;
    window.__CURVE_TOUR_SYNC_TRANSPORT__ = {
      update: () => Promise.resolve(),
      subscribe(tournamentId, onValue) {
        if (tournamentId in stored) onValue(stored[tournamentId]);
        return () => {};
      },
    };
    try {
      for (const [id, picture] of Object.entries(screenshots))
        window.localStorage.setItem(`curveFFA_img_${id}`, picture);
    } catch {
      // Without storage the screenshots simply do not show.
    }
  }, served);
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}

async function capture(page: Page, fixtureId: string, name: string): Promise<void> {
  const directory = `${OUTPUT_DIR}/${fixtureId}`;
  mkdirSync(directory, { recursive: true });
  // Let the views settle (fonts, effects that run after hydration).
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${directory}/${name}.png`,
    fullPage: true,
  });
}

function fileName(tab: string, suffix: string): string {
  return `${tab.toLowerCase().replace(/\W+/g, '-')}-${suffix}`;
}

/**
 * The rounds row of the Bracket scrolls sideways inside the page (whose content is capped at 1280 px), so a plain
 * capture cuts it at the viewport's edge. This lifts the cap, widens the viewport to the whole row plus the page
 * padding, captures it and puts everything back.
 */
async function captureFullBracket(page: Page, fixtureId: string, name: string, width: number): Promise<void> {
  const rounds = page.locator('#br-rounds');
  const padding = await rounds.evaluate((element) => window.innerWidth - element.clientWidth);
  const height = page.viewportSize()?.height ?? 900;
  const uncap = await page.addStyleTag({ content: 'main { max-width: none !important; }' });
  const rowWidth = await rounds.evaluate((element) => element.scrollWidth);
  await page.setViewportSize({ width: rowWidth + padding, height });
  await capture(page, fixtureId, `${name}-${width}`);
  await uncap.evaluate((element) => (element as Element).remove());
  await page.setViewportSize({ width, height });
}

/** The page is never wider than the viewport: nothing makes a phone scroll sideways. */
async function expectNoSidewaysPageScroll(page: Page, width: number): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, 'no sideways page scroll').toBeLessThanOrEqual(width);
}

/** The notes panel and the "?" box of the Bracket, when the fixture asks for them, saved with the top of the page. */
async function captureBracketPanels(page: Page, fixture: FixtureTournament, width: number): Promise<void> {
  if (fixture.notesPanel) {
    await page.getByRole('button', { name: 'Notes about this tournament' }).click();
    await expect(page.getByRole('dialog', { name: 'Notes' })).toBeVisible();
    await page.screenshot({
      path: `${OUTPUT_DIR}/${fixture.id}/notes-panel-${width}.png`,
      clip: { x: 0, y: 0, width, height: 640 },
    });
    await page.getByRole('button', { name: 'Close' }).click();
  }
  if (fixture.infoBox) {
    await page.getByRole('button', { name: 'How to read the bracket' }).click();
    await expect(page.getByRole('dialog', { name: 'How to read the bracket' })).toBeVisible();
    await page.screenshot({
      path: `${OUTPUT_DIR}/${fixture.id}/info-box-${width}.png`,
      clip: { x: 0, y: 0, width, height: 760 },
    });
    await page.getByRole('button', { name: 'Close' }).click();
  }
}

/** A followed unit on a phone: the follow row (input, icons) with its banner on a line of its own. */
async function captureFollowRow(page: Page, fixture: FixtureTournament): Promise<void> {
  if (!fixture.follow) return;
  await page.locator('#br-follow-input').fill(fixture.follow);
  await capture(page, fixture.id, 'bracket-follow-390');
  await page.locator('#br-follow-input').fill('');
}

/** The Bracket's round strip on a phone: the standings item, then a round picked from the group's list. */
async function capturePhoneStrip(page: Page, fixtureId: string): Promise<void> {
  const strip = page.getByRole('tablist', { name: 'Rounds' });
  await strip.getByRole('tab', { name: /^Qualification/ }).click();
  await capture(page, fixtureId, 'bracket-standings-390');
  await strip.getByRole('tab', { name: /^R1–3/ }).click();
  await capture(page, fixtureId, 'bracket-group-menu-390');
  await page.getByRole('menuitem', { name: /^Round 2/ }).click();
  await capture(page, fixtureId, 'bracket-group-pick-390');
  await expectNoSidewaysPageScroll(page, 390);
  await strip.getByRole('tab', { name: /^Round 4/ }).click();
}

/** Hovers the n-th exit icon of the Bracket and saves the area around its pop-up. */
async function captureExitPopup(page: Page, fixtureId: string, nth: number, width: number): Promise<void> {
  const icon = page.getByRole('button', { name: /Where players go from/ }).nth(nth);
  await icon.scrollIntoViewIfNeeded();
  await icon.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  const box = await icon.boundingBox();
  if (!box) throw new Error('the exit icon has no box');
  const x = Math.max(0, box.x - 300);
  const y = Math.max(0, box.y - 6);
  await page.screenshot({
    path: `${OUTPUT_DIR}/${fixtureId}/exit-popup-${nth}-${width}.png`,
    clip: { x, y, width: Math.min(width - x, 380), height: 260 },
  });
  await page.mouse.move(0, 0);
}

function servedFor(fixture: FixtureTournament): ServedPage {
  return {
    index: { [fixture.id]: fixtureIndexEntry(fixture) },
    stored: { [fixture.id]: storedState(fixture) },
    screenshots: Object.fromEntries(
      (fixture.screenshotIds ?? []).map((id, index) => [id, lobbyPicture(index)]),
    ),
  };
}

test.describe('screenshots of the viewer tabs', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/Paris' });

  let consoleErrors: string[];

  test.beforeEach(({ page }) => {
    consoleErrors = collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors, 'expected zero console errors').toEqual([]);
  });

  for (const width of WIDTHS) {
    for (const fixture of fixtureTournaments()) {
      test(`${fixture.id} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await serve(page, servedFor(fixture));
        await open(page, `/?t=${fixture.id}`);
        const nav = page.getByRole('navigation', { name: 'Tournament sections' });

        for (const tab of fixture.tabs) {
          await nav.getByRole('button', { name: new RegExp(tab) }).click();
          await capture(page, fixture.id, fileName(tab, String(width)));
          if (tab === 'Bracket' && width === WIDTHS[1]) {
            await expectNoSidewaysPageScroll(page, width);
            await captureBracketPanels(page, fixture, width);
            await captureFollowRow(page, fixture);
            if (fixture.id === 'ffa37-quarters') await capturePhoneStrip(page, fixture.id);
          }
          if (tab === 'Bracket' && width === WIDTHS[0]) {
            await captureFullBracket(page, fixture.id, 'bracket-full', width);
            // The "?" (and the notes icon before it) sit at the far right of the follow row.
            const rightGap = await page.locator('#br-follow-input').evaluate((input) => {
              const row = input.parentElement?.getBoundingClientRect();
              const help = input.parentElement?.querySelector('[aria-label="How to read the bracket"]');
              return row && help ? row.right - help.getBoundingClientRect().right : null;
            });
            expect(rightGap, 'the "?" is at the right edge of the follow row').not.toBeNull();
            expect(rightGap ?? 99).toBeLessThanOrEqual(4);
            // The standings column's title is never cut, even beside the longest tag (TEMPORARY) and both icons.
            const standingsTitle = page.locator('[data-standings-column] h2');
            if ((await standingsTitle.count()) > 0) {
              const fits = await standingsTitle.evaluate((title) => title.scrollWidth <= title.clientWidth);
              expect(fits, 'the standings title fits').toBe(true);
            }
            await captureBracketPanels(page, fixture, width);
            for (const nth of fixture.exitPopups ?? []) await captureExitPopup(page, fixture.id, nth, width);
            if (fixture.follow) {
              await page.locator('#br-follow-input').fill(fixture.follow);
              await captureFullBracket(page, fixture.id, 'bracket-follow-full', width);
              const standingsTab = fixture.tabs.find((tab) => STANDINGS_TABS.includes(tab));
              if (standingsTab) {
                // The follow is stored per browser, so the standings tab shows the same banner.
                await nav.getByRole('button', { name: new RegExp(standingsTab) }).click();
                await capture(page, fixture.id, fileName('Standings follow', String(width)));
                await page
                  .getByRole('button', { name: /Where players go from/ })
                  .first()
                  .focus();
                await capture(page, fixture.id, fileName('Standings exit popup', String(width)));
                await nav.getByRole('button', { name: /Bracket/ }).click();
              }
              await page.locator('#br-follow-input').fill('');
            }
          }
        }
      });
    }

    test(`the tournament list at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // The one ongoing tournament loads by itself; its own fixture is the Quarters one.
      const ongoing = fixtureTournaments().find((fixture) => fixture.id === 'ffa37-quarters');
      if (!ongoing) throw new Error('the ffa37-quarters fixture is missing');
      const live = { ...ongoing, id: 'live-cup' };
      await serve(page, {
        index: tournamentListIndex(Date.now()),
        stored: { 'live-cup': storedState(live) },
        screenshots: {},
      });
      await open(page, '/');
      // On a phone this button sits in the header line, outside the tab row; only one is ever visible.
      await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
      await capture(page, 'tournament-list', fileName('Tournaments', String(width)));
    });

    test(`the Log in link sits below every card at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 600 });
      await serve(page, { index: tournamentListIndex(Date.now()), stored: {}, screenshots: {} });
      await open(page, '/');
      // In page coordinates, so the same holds in a full-page capture and while scrolling.
      const { link, lowestCard } = await page.evaluate(() => {
        const top = (element: Element) => element.getBoundingClientRect().top + window.scrollY;
        const bottom = (element: Element) => element.getBoundingClientRect().bottom + window.scrollY;
        const login = [...document.querySelectorAll('#view-tournaments button')].find((button) =>
          /Log in as admin/.test(button.textContent ?? ''),
        );
        const cards = [...document.querySelectorAll('#view-tournaments ul li button')];
        return { link: login ? top(login) : null, lowestCard: Math.max(...cards.map(bottom)) };
      });
      expect(link, 'the Log in link is on the page').not.toBeNull();
      expect(link ?? 0).toBeGreaterThanOrEqual(lowestCard);
      const position = await page
        .getByRole('button', { name: 'Log in as admin' })
        .evaluate((element) => getComputedStyle(element).position);
      expect(position, 'the link is part of the page, not fixed to the screen').not.toBe('fixed');
    });

    test(`the unavailable-link notice at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await serve(page, { index: tournamentListIndex(Date.now()), stored: {}, screenshots: {} });
      await open(page, '/?t=missing-cup');
      await expect(page.getByText("This tournament isn't available.")).toBeVisible();
      await capture(page, 'tournament-list', fileName('Unavailable', String(width)));
    });
  }
});

test.describe('screenshots with touch', () => {
  test.use({
    locale: 'en-GB',
    timezoneId: 'Europe/Paris',
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test('the exit pop-ups open on tap, have a close button and stay inside the screen', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-quarters');
    if (!fixture) throw new Error('the ffa37-quarters fixture is missing');
    await serve(page, servedFor(fixture));
    await open(page, `/?t=${fixture.id}`);
    const fixtureId = fixture.id;
    mkdirSync(`${OUTPUT_DIR}/${fixtureId}`, { recursive: true });

    // Each pop-up opens on tap, shows its close button and lies fully inside the 390 px screen, with no scrolling first.
    async function checkPopup(icon: Locator, picture: string): Promise<void> {
      await icon.tap();
      const popup = page.getByRole('tooltip');
      await expect(popup).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
      const edges = await popup.evaluate((element) => {
        const { left, right } = element.getBoundingClientRect();
        return { left, right };
      });
      expect(edges.left, 'the pop-up starts inside the screen').toBeGreaterThanOrEqual(0);
      expect(edges.right, 'the pop-up ends inside the screen').toBeLessThanOrEqual(390);
      const box = await icon.boundingBox();
      if (!box) throw new Error('the exit icon has no box');
      await page.screenshot({
        path: `${OUTPUT_DIR}/${fixtureId}/${picture}-390.png`,
        clip: { x: 0, y: Math.max(0, box.y - 6), width: 390, height: 260 },
      });
      await page.getByRole('button', { name: 'Close' }).tap();
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    }

    // The shown box is Round 4: its Room A is the first exit icon on the page.
    await checkPopup(page.getByRole('button', { name: /Where players go from/ }).first(), 'exit-popup-touch');
    // The standings column is a tab of its own on a phone.
    await page.getByRole('tab', { name: /^Qualification/ }).tap();
    await checkPopup(
      page.getByRole('button', { name: 'Where players go from qualification' }),
      'exit-popup-touch-standings',
    );
    expect(errors, 'expected zero console errors').toEqual([]);
  });
});

test.describe('the rankings image', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/Paris' });

  // A finished tournament (podium colours) and a running one (those still in, the label "LIVE").
  for (const id of [
    'ffa37-finished',
    'ffa37-quarters',
    'teams2v2-13-finished',
    'teams-5v5-final',
    'teams-4v4-13',
    'long-names-teams3-13-finished',
  ]) {
    test(`${id}: Download image saves a PNG`, async ({ page }) => {
      const fixture = fixtureTournaments().find((candidate) => candidate.id === id);
      if (!fixture) throw new Error(`no fixture ${id}`);
      const errors = collectConsoleErrors(page);
      await page.setViewportSize({ width: 1280, height: 900 });
      await serve(page, servedFor(fixture));
      await open(page, `/?t=${id}`);
      await page
        .getByRole('navigation', { name: 'Tournament sections' })
        .getByRole('button', { name: /Rankings/ })
        .click();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download image' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/-rankings\.png$/);
      mkdirSync(`${OUTPUT_DIR}/${id}`, { recursive: true });
      await file.saveAs(`${OUTPUT_DIR}/${id}/rankings-image.png`);
      expect(errors, 'expected zero console errors').toEqual([]);
    });
  }
});
