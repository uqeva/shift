import { defineConfig, devices } from '@playwright/test';

/**
 * STORY 21.21 (AD-28). The public page's Chromium check, against a RUNNING
 * `shift-landing` image (never a dev server: the headers, the policy and the
 * transfer sizes are the image's). CI's `landing-image` job starts the image it
 * built on a loopback port and runs, from the repository root:
 *
 *   LANDING_BASE_URL=http://127.0.0.1:<port> pnpm exec playwright test -c apps/landing/playwright.config.ts
 *
 * `LANDING_SCREENSHOT_DIR`, when set, receives a full-page screenshot per width
 * and theme. No webServer, no global setup, no database.
 */
export default defineConfig({
  testDir: './check',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: process.env['LANDING_BASE_URL'] ?? 'http://127.0.0.1:8080',
    locale: 'hr-HR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
