import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'hosted-registration.spec.ts',
	outputDir: './private/playwright-output',
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	reporter: [['list']],
	timeout: 240_000,
	use: {
		baseURL: 'https://perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev',
		trace: 'retain-on-failure',
		video: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
