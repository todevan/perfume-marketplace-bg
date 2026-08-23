import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: 'registration-hosted.spec.ts',
	outputDir: './test-results/issue22-hosted',
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	reporter: [['list']],
	timeout: 360_000,
	use: {
		baseURL: process.env.ISSUE22_HOSTED_ORIGIN ?? 'https://invalid.invalid',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
