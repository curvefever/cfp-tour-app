import { defineConfig, devices } from '@playwright/test';

// Defaults to a local dev server. Set PLAYWRIGHT_BASE_URL to point at a real
// deployed environment instead (e.g. https://tournaments-test.curvefever.pro) --
// in that case Playwright drives a real browser against the real site, so no
// local server is started.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const isLocal = new URL(baseURL).hostname === 'localhost';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL,
  },
  webServer: isLocal
    ? {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      testIgnore: 'screens/**',
      use: { ...devices['Desktop Chrome'] },
    },
    // Screenshots of the viewer tabs for the visual redesign (`pnpm run test:screens`); not part of the smoke run.
    {
      name: 'screens',
      testDir: './e2e/screens',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
