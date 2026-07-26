import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: process.env.CI ? false : true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PUBLIC_DEMO_MODE: 'true',
      APP_ENV: 'development',
      PUBLIC_APP_URL: 'http://127.0.0.1:4173'
    }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } }
  ]
});
