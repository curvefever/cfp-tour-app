import { expect, test, type Page } from '@playwright/test';

async function gotoHydrated(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  // The app renders server-side markup before React attaches its event
  // listeners; clicking too early is a no-op. Wait for its own hydration signal.
  await page.waitForSelector('main[data-hydrated="true"]');
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

interface FixtureTournament {
  id: string;
  title: string;
  /** Published tournaments are upcoming until `started`. */
  started: boolean;
}

/**
 * Stands in for the database: the tournament list and each tournament's stored state are supplied by the page,
 * so the visitor rules can be exercised without any data on the test site.
 */
async function serveTournaments(page: Page, tournaments: FixtureTournament[]): Promise<void> {
  await page.addInitScript((fixtures: FixtureTournament[]) => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const scheduledAt = (entry: FixtureTournament) => Date.now() + (entry.started ? -60 * 60 * 1000 : week);
    window.__CURVE_TOUR_INDEX__ = Object.fromEntries(
      fixtures.map((entry) => [
        entry.id,
        {
          title: entry.title,
          status: 'published',
          started: entry.started,
          testRun: false,
          scheduledAt: scheduledAt(entry),
          createdAt: 1,
          finishedAt: null,
          gameFormat: 'ffa-individual',
          poolingPhase: 'none',
          scheduleLogic: 'single-elimination',
          unitCount: 37,
        },
      ]),
    );
    window.__CURVE_TOUR_SYNC_TRANSPORT__ = {
      update: () => Promise.resolve(),
      subscribe(tournamentId, onValue) {
        const entry = fixtures.find((candidate) => candidate.id === tournamentId);
        if (entry) {
          onValue({
            title: entry.title,
            tournamentId,
            started: entry.started,
            lifecycle: { status: 'published', testRun: false, createdAt: 1, finishedAt: { __ffaNull: true } },
            info: { scheduledAt: scheduledAt(entry), rulesText: '', screenshots: { __ffaEmptyArray: true } },
            players: ['A', 'B', 'C'],
          });
        }
        return () => {};
      },
    };
  }, tournaments);
}

test.describe('visitor smoke test', () => {
  let consoleErrors: string[];

  test.beforeEach(({ page }) => {
    consoleErrors = collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors, 'expected zero console errors').toEqual([]);
  });

  test('a signed-out visitor lands on Tournaments, with no tournament tabs', async ({ page }) => {
    await serveTournaments(page, []);
    await gotoHydrated(page);

    await expect(page.getByText('CFP Tournament Hub')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });
    await expect(nav.getByRole('button')).toHaveCount(1);
    await expect(nav.getByRole('button', { name: /Tournaments/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#view-tournaments')).toBeVisible();
    await expect(page.getByText('No tournament currently ongoing')).toBeVisible();
    await expect(page.getByText('New tournaments coming out soon!')).toBeVisible();
    await expect(page.getByText('No tournament completed yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit tournament view' })).toHaveCount(0);
  });

  test('the Log in as admin link on Tournaments opens the CFP login modal without navigating away', async ({
    page,
  }) => {
    await serveTournaments(page, []);
    await gotoHydrated(page);
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await page.getByRole('button', { name: 'Log in as admin' }).click();

    const dialog = page.getByRole('dialog', { name: 'Sign in with CFP' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeVisible();
    await expect(dialog.getByLabel('Password')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(nav.getByRole('button', { name: /Tournaments/ })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button', { name: /Admin/ })).toHaveCount(0);
  });

  test('a link to a published tournament opens its Info, and the tabs follow its phase', async ({ page }) => {
    await serveTournaments(page, [{ id: 'cup', title: 'Autumn Cup', started: false }]);
    await gotoHydrated(page, '/?t=cup');
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await expect(nav.getByRole('button', { name: /Info/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#view-info')).toBeVisible();
    await expect(page.locator('#view-info').getByRole('heading', { name: 'Autumn Cup' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'General tournament rules' })).toHaveAttribute(
      'href',
      'https://info.curvefever.pro/tournaments/tournament-rules',
    );
    // Not started: the roster is shown as Players, and there is no Bracket or Standings yet.
    await expect(nav.getByRole('button', { name: /Players/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: /Bracket/ })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: /Standings/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exit tournament view' })).toBeVisible();
  });

  test('switching between the tabs of a tournament works, and Tournaments lists it', async ({ page }) => {
    await serveTournaments(page, [{ id: 'cup', title: 'Autumn Cup', started: false }]);
    await gotoHydrated(page, '/?t=cup');
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await nav.getByRole('button', { name: /Players/ }).click();
    await expect(page.locator('#view-rankings')).toBeVisible();
    await expect(page.locator('#view-info')).toHaveCount(0);

    await nav.getByRole('button', { name: /Tournaments/ }).click();
    const upcoming = page.locator('#view-tournaments').getByRole('button', { name: /Autumn Cup/ });
    await expect(upcoming).toBeVisible();
    await expect(upcoming).toContainText('37 players');

    await nav.getByRole('button', { name: /Info/ }).click();
    await expect(page.locator('#view-info')).toBeVisible();

    await nav.getByRole('button', { name: /Players/ }).click();
    await page.getByRole('button', { name: 'CFP Tournament Hub' }).click();
    await expect(nav.getByRole('button', { name: /Tournaments/ })).toHaveAttribute('aria-current', 'page');
    // The title only opens the list: the tournament stays loaded, and its Info (the only place with Exit) is still there.
    await expect(page.getByRole('button', { name: 'Exit tournament view' })).toHaveCount(0);
    await nav.getByRole('button', { name: /Info/ }).click();
    await expect(page.getByRole('button', { name: 'Exit tournament view' })).toBeVisible();
  });

  test('a reload returns to the tab the visitor was last on in that tournament', async ({ page }) => {
    await serveTournaments(page, [{ id: 'cup', title: 'Autumn Cup', started: false }]);
    await gotoHydrated(page, '/?t=cup');
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await nav.getByRole('button', { name: /Players/ }).click();
    await expect(nav.getByRole('button', { name: /Players/ })).toHaveAttribute('aria-current', 'page');

    await gotoHydrated(page, '/?t=cup');
    await expect(nav.getByRole('button', { name: /Players/ })).toHaveAttribute('aria-current', 'page');
  });

  test('a link to a tournament that is not there opens Tournaments with a notice', async ({ page }) => {
    await serveTournaments(page, [{ id: 'cup', title: 'Autumn Cup', started: false }]);
    await gotoHydrated(page, '/?t=missing');

    await expect(page.getByText("This tournament isn't available.")).toBeVisible();
    await expect(page.locator('#view-tournaments')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit tournament view' })).toHaveCount(0);
  });

  test('a visit without a link loads the only ongoing tournament, and Exit sticks across a reload', async ({
    page,
  }) => {
    await serveTournaments(page, [
      { id: 'live', title: 'Live Cup', started: true },
      { id: 'later', title: 'Later Cup', started: false },
    ]);
    await gotoHydrated(page);
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await expect(nav.getByRole('button', { name: /Bracket/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Live Cup' })).toBeVisible();
    // The tournament's tabs sit together on their own band.
    await expect(page.getByRole('group', { name: 'This tournament' })).toBeVisible();

    await nav.getByRole('button', { name: /Info/ }).click();
    await page.getByRole('button', { name: 'Exit tournament view' }).click();
    await expect(nav.getByRole('button', { name: /Tournaments/ })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button')).toHaveCount(1);

    await gotoHydrated(page);
    await expect(nav.getByRole('button', { name: /Tournaments/ })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Exit tournament view' })).toHaveCount(0);
  });
});
