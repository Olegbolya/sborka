import { defineConfig, devices } from '@playwright/test';

// Local agent sandbox ships its own Chromium; CI installs browsers with `playwright install`.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const port = Number(process.env.E2E_WEB_PORT ?? 3110);
const apiPort = Number(process.env.API_PORT ?? 3100);
// The API runs on the same host name as the site, so the session cookie set by the OAuth callback reaches the site.
const webOrigin = `http://127.0.0.1:${port}`;
const e2eDatabaseUrl = process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test';

const mobile = { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  // P1.10: reference images of the visual tests, one per gallery, theme and width (ADR-029).
  snapshotPathTemplate: '{testDir}/__visual__/{arg}-{projectName}{ext}',
  // They are made on CI's runner and browser; another machine draws fonts a little differently, so outside CI
  // the comparison is skipped unless VISUAL=1 (then a local run checks against local references).
  ignoreSnapshots: !process.env.CI && !process.env.VISUAL,
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'mobile-390', testIgnore: 'perf/**', use: mobile },
    { name: 'desktop-1440', testIgnore: 'perf/**', use: desktop },
    // Frame-rate budgets of the player (SC-05: «на среднем телефоне, эмуляция CPU ×4»): the phone profile, after
    // all other tests and one at a time, so nothing else competes for the processor while frames are counted (ADR-028).
    { name: 'perf-390', testMatch: 'perf/**/*.spec.ts', dependencies: ['mobile-390', 'desktop-1440'], fullyParallel: false, use: mobile },
  ],
  webServer: [
    {
      // A-01 (ADR-034): login is tested through the development provider emulator, so the real API and its database run.
      command: 'bash scripts/dev-services.sh && pnpm db:migrate && pnpm --filter @blokum/api start',
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        DATABASE_URL: e2eDatabaseUrl,
        API_PORT: String(apiPort),
        WEB_URL: webOrigin,
        ALLOWED_ORIGINS: webOrigin,
      },
    },
    {
      command: `pnpm --filter @blokum/web exec next start --port ${port} --hostname 127.0.0.1`,
      url: `http://127.0.0.1:${port}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Service galleries /dev/* (P1.4–P1.9) are tested on the production build.
      env: { NEXT_TELEMETRY_DISABLED: '1', BLOKUM_DEV_PAGES: '1' },
    },
  ],
});
