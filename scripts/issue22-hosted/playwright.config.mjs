import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'issue22-hosted-proof.e2e.mjs',
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	reporter: [['line']],
	preserveOutput: 'never',
	use: {
		trace: 'off',
		video: 'off',
		screenshot: 'off',
		serviceWorkers: 'block'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

