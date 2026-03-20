// Playwright E2E config (B4.4). Run: npm run e2e (or e2e:ci for CI with preview server).
import { defineConfig, devices } from '@playwright/test';

const isCI = process.env.CI === 'true';
const baseURL = isCI ? 'http://localhost:4173' : (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');
const webServerConfig = isCI
  ? {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
    }
  : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['html', { outputFolder: '../test_reports/playwright' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: webServerConfig,
});
