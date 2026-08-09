import { defineConfig, devices } from '@playwright/test';
import { HOSTED_STAGING } from './scripts/hosted-report-evidence-operator.mjs';

const configuredOrigin = process.env.E2E_REAL_BASE_URL?.trim();
if (configuredOrigin && configuredOrigin !== HOSTED_STAGING.workerOrigin) {
	throw new Error('Hosted Playwright target does not match the approved staging Worker.');
}

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	reporter: [['line']],
	preserveOutput: 'never',
	use: {
		baseURL: HOSTED_STAGING.workerOrigin,
		trace: 'off',
		video: 'off',
		screenshot: 'off'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
