import { defineConfig, devices } from '@playwright/test';

const supabaseUrl = process.env.REGISTRATION_SUPABASE_URL ?? 'http://127.0.0.1:45321';
const anonKey =
	process.env.REGISTRATION_SUPABASE_ANON_KEY ??
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlLWRlbW8iLCJyb2xlIjoiYW5vbiIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: 'registration-local.spec.ts',
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: 'http://127.0.0.1:5173',
		trace: 'retain-on-failure'
	},
	webServer: {
		command:
			'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 5173 --strictPort',
		port: 5173,
		reuseExistingServer: process.env.REGISTRATION_REUSE_SERVER === 'true',
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			PUBLIC_DEMO_MODE: 'false',
			APP_ENV: 'development',
			PUBLIC_APP_URL: 'http://127.0.0.1:5173',
			PUBLIC_SUPABASE_URL: supabaseUrl,
			PUBLIC_SUPABASE_ANON_KEY: anonKey,
			PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA'
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
