import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  fixtureTournaments,
  indexEntry,
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

// A plain picture standing in for a lobby screenshot; the page reads it from the browser cache.
const SCREENSHOT_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1d3a5a"/><rect x="40" y="40" width="560" height="280" fill="#102e44"/></svg>',
)}`;

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
  screenshotIds: string[];
}

/** Stands in for the database: the tournament list, each stored tournament and the cached lobby screenshots. */
async function serve(page: Page, served: ServedPage): Promise<void> {
  await page.addInitScript(
    ({ index, stored, screenshotIds, screenshot }) => {
      window.__CURVE_TOUR_INDEX__ = index;
      window.__CURVE_TOUR_SYNC_TRANSPORT__ = {
        update: () => Promise.resolve(),
        subscribe(tournamentId, onValue) {
          if (tournamentId in stored) onValue(stored[tournamentId]);
          return () => {};
        },
      };
      try {
        for (const id of screenshotIds) window.localStorage.setItem(`curveFFA_img_${id}`, screenshot);
      } catch {
        // Without storage the screenshots simply do not show.
      }
    },
    { ...served, screenshot: SCREENSHOT_DATA_URL },
  );
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}

async function capture(page: Page, fixtureId: string, tab: string, width: number): Promise<void> {
  const directory = `${OUTPUT_DIR}/${fixtureId}`;
  mkdirSync(directory, { recursive: true });
  // Let the views settle (fonts, effects that run after hydration).
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${directory}/${tab.toLowerCase().replace(/\W+/g, '-')}-${width}.png`,
    fullPage: true,
  });
}

function servedFor(fixture: FixtureTournament): ServedPage {
  const started = fixture.state.started;
  return {
    index: {
      [fixture.id]: indexEntry(fixture.state.title, {
        status: fixture.status,
        started,
        scheduledAt: Date.now() + (started ? -2 : 100) * 60 * 60 * 1000,
      }),
    },
    stored: { [fixture.id]: storedState(fixture) },
    screenshotIds: fixture.screenshotIds ?? [],
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
          await capture(page, fixture.id, tab, width);
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
        screenshotIds: [],
      });
      await open(page, '/');
      await page
        .getByRole('navigation', { name: 'Tournament sections' })
        .getByRole('button', { name: /Tournaments/ })
        .click();
      await capture(page, 'tournament-list', 'Tournaments', width);
    });
  }
});
