import { expect, test, type Page } from '@playwright/test';

async function gotoHydrated(page: Page): Promise<void> {
  await page.goto('/');
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

test.describe('anonymous visitor smoke test', () => {
  let consoleErrors: string[];

  test.beforeEach(({ page }) => {
    consoleErrors = collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors, 'expected zero console errors').toEqual([]);
  });

  test('renders the app shell for an anonymous visitor', async ({ page }) => {
    await gotoHydrated(page);

    await expect(page.getByText('CFP Tour Hub')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Tournament sections' });
    await expect(nav.getByRole('button', { name: '⚙ Admin' })).toBeVisible();
    await expect(nav.getByRole('button', { name: '📊 Scoreboard' })).toBeVisible();
    await expect(nav.getByRole('button', { name: '🗂 Bracket' })).toBeVisible();
    await expect(nav.getByRole('button', { name: '🏆 Rankings' })).toBeVisible();
    await expect(nav.getByRole('button', { name: '🗄 Archive' })).toBeVisible();

    await expect(nav.getByRole('button', { name: '🗂 Bracket' })).toHaveAttribute('aria-current', 'page');
  });

  test('switching between viewer tabs works', async ({ page }) => {
    await gotoHydrated(page);
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await nav.getByRole('button', { name: '📊 Scoreboard' }).click();
    await expect(page.locator('#view-scoreboard')).toBeVisible();
    await expect(page.locator('#view-bracket')).toBeHidden();

    await nav.getByRole('button', { name: '🏆 Rankings' }).click();
    await expect(page.locator('#view-rankings')).toBeVisible();
    await expect(page.locator('#view-scoreboard')).not.toBeVisible();

    await nav.getByRole('button', { name: '🗄 Archive' }).click();
    await expect(page.locator('#view-archive')).toBeVisible();
    await expect(page.locator('#view-rankings')).not.toBeVisible();

    await nav.getByRole('button', { name: '🗂 Bracket' }).click();
    await expect(page.locator('#view-bracket')).toBeVisible();
    await expect(page.locator('#view-archive')).not.toBeVisible();
  });

  test('clicking Admin opens the CFP login modal without navigating away', async ({ page }) => {
    await gotoHydrated(page);
    const nav = page.getByRole('navigation', { name: 'Tournament sections' });

    await nav.getByRole('button', { name: '⚙ Admin' }).click();

    const dialog = page.getByRole('dialog', { name: 'Sign in with CFP' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeVisible();
    await expect(dialog.getByLabel('Password')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(nav.getByRole('button', { name: '🗂 Bracket' })).toHaveAttribute('aria-current', 'page');
  });
});
