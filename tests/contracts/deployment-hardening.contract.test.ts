import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as getRobots } from '../../src/routes/robots.txt/+server';
import { GET as getSitemap } from '../../src/routes/sitemap.xml/+server';

const workspace = resolve(import.meta.dirname, '../..');
const readinessScript = resolve(workspace, 'scripts/check-production-readiness.mjs');
const deploymentWorkflowPath = resolve(workspace, '.github/workflows/deploy.yml');
const qualityWorkflowPath = resolve(workspace, '.github/workflows/ci.yml');
const packageJsonPath = resolve(workspace, 'package.json');
const billingFlags = [
	'FEATURE_BILLING_ENABLED',
	'FEATURE_LISTING_FEES_ENABLED',
	'FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED',
	'FEATURE_BOOSTS_ENABLED',
	'FEATURE_DIRECT_ADS_ENABLED',
	'FEATURE_MYPOS_PAYMENTS_ENABLED',
	'FEATURE_STRIPE_FALLBACK_ENABLED'
] as const;

const validReleaseEnvironment: NodeJS.ProcessEnv = {
	...process.env,
	APP_ENV: 'production',
	PUBLIC_DEMO_MODE: 'false',
	PRIVATE_BETA_REQUIRE_INVITE: 'true',
	PRIVATE_BETA_REQUIRE_STAFF_MFA: 'true',
	LEGAL_CONTENT_APPROVED: 'true',
	PAYMENT_PROVIDER: 'disabled',
	FEATURE_SMS_VERIFICATION_ENABLED: 'true',
	IMAGE_PROCESSOR_MODE: 'cloudflare-images',
	PUBLIC_APP_URL: 'https://perfume.example.com',
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
	SUPABASE_SECRET_KEY: 'secret-test-key',
	TERMS_VERSION: '2026-07-26',
	PRIVACY_VERSION: '2026-07-26',
	MARKETPLACE_RULES_VERSION: '2026-07-26',
	INCIDENT_CONTACT_EMAIL: 'incidents@example.com',
	RESEND_API_KEY: 're_test_key',
	RESEND_FROM_EMAIL: 'Marketplace <notifications@example.com>',
	TURNSTILE_SECRET_KEY: 'turnstile-secret',
	PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site-key',
	TURNSTILE_EXPECTED_HOSTNAME: 'perfume.example.com',
	SUPABASE_AUTH_SMS_TWILIO_ACCOUNT_SID: 'ACtest',
	SUPABASE_AUTH_SMS_TWILIO_MESSAGE_SERVICE_SID: 'MGtest',
	SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN: 'twilio-token',
	CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account',
	CLOUDFLARE_IMAGES_API_TOKEN: 'cloudflare-images-token',
	NOTIFICATION_WEBHOOK_SECRET: 'n'.repeat(32),
	UPLOAD_CLEANUP_SECRET: 'u'.repeat(32)
};

for (const flag of billingFlags) {
	validReleaseEnvironment[flag] = 'false';
}

function runReadiness(environment: NodeJS.ProcessEnv = validReleaseEnvironment) {
	return spawnSync(process.execPath, [readinessScript], {
		cwd: workspace,
		encoding: 'utf8',
		env: environment
	});
}

describe('closed beta deployment hardening', () => {
	it('keeps deployment manual, staging-only, and guarded to main', () => {
		const workflow = readFileSync(deploymentWorkflowPath, 'utf8');
		const triggerBlock = workflow.match(/^on:\r?\n([\s\S]*?)^permissions:/m)?.[1];
		expect(triggerBlock?.trim()).toBe('workflow_dispatch:');

		const jobsBlock = workflow.slice(workflow.indexOf('\njobs:') + '\njobs:'.length);
		const jobNames = [...jobsBlock.matchAll(/^  ([a-z0-9_-]+):\r?$/gim)].map(
			(match) => match[1]
		);
		expect(jobNames).toEqual(['staging']);
		expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
		expect(workflow).not.toMatch(/^\s+environment:/m);
		expect(workflow).not.toContain('--env=""');
	});

	it('uses repository secrets and validates staging before the only deploy step', () => {
		const workflow = readFileSync(deploymentWorkflowPath, 'utf8');
		expect(workflow).toContain('group: deploy-staging');
		expect(workflow).toContain('cancel-in-progress: false');
		expect(workflow).toContain(
			'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}'
		);
		expect(workflow).toContain(
			'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}'
		);
		expect(workflow).not.toContain('${{ vars.');

		const install = workflow.indexOf('run: pnpm install --frozen-lockfile');
		const productionAudit = workflow.indexOf('run: pnpm audit --prod');
		const highAudit = workflow.indexOf('run: pnpm audit --audit-level high');
		const tests = workflow.indexOf('run: pnpm test');
		const dryRun = workflow.indexOf(
			'run: pnpm exec wrangler deploy --dry-run --env staging'
		);
		const deploy = workflow.indexOf('run: pnpm exec wrangler deploy --env staging');

		expect(install).toBeGreaterThan(-1);
		expect(productionAudit).toBeGreaterThan(install);
		expect(highAudit).toBeGreaterThan(productionAudit);
		expect(tests).toBeGreaterThan(highAudit);
		expect(dryRun).toBeGreaterThan(tests);
		expect(deploy).toBeGreaterThan(dryRun);
		expect(workflow.match(/run: pnpm exec wrangler deploy --env staging/g)).toHaveLength(1);
	});

	it('installs every browser engine used by the Playwright project matrix', () => {
		const workflow = readFileSync(qualityWorkflowPath, 'utf8');
		expect(workflow).toContain(
			'pnpm exec playwright install --with-deps chromium webkit'
		);
	});

	it('exposes only an explicit staging deploy package script', () => {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts.deploy).toBeUndefined();
		expect(packageJson.scripts['deploy:production']).toBeUndefined();
		expect(packageJson.scripts['deploy:staging']).toBe(
			'vite build && wrangler deploy --env staging'
		);
		expect(packageJson.scripts['db:lint']).toBe(
			'supabase db lint --local --level warning --fail-on warning'
		);
	});

	it('routes crawler endpoints through the Worker and has no static robots bypass', async () => {
		const wrangler = JSON.parse(readFileSync(resolve(workspace, 'wrangler.jsonc'), 'utf8'));
		expect(wrangler.assets.run_worker_first).toEqual(
			expect.arrayContaining(['/robots.txt', '/sitemap.xml'])
		);
		expect(existsSync(resolve(workspace, 'static/robots.txt'))).toBe(false);

		const response = await getRobots({} as never);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
		expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');

		const sitemapResponse = await getSitemap({
			url: new URL('https://perfume.example.com/sitemap.xml')
		} as never);
		expect(sitemapResponse.status).toBe(404);
		expect(sitemapResponse.headers.get('x-robots-tag')).toBe('noindex, nofollow');
	});

	it('keeps production private while preserving the staging test address and Images binding', () => {
		const wrangler = JSON.parse(readFileSync(resolve(workspace, 'wrangler.jsonc'), 'utf8'));
		expect(wrangler.workers_dev).toBe(false);
		expect(wrangler.images).toEqual({ binding: 'IMAGES' });
		expect(wrangler.env.staging.workers_dev).toBe(true);
		expect(wrangler.env.staging.images).toEqual({ binding: 'IMAGES' });
	});

	it('passes the release contract only with demo mode and every billing flag disabled', () => {
		const result = runReadiness();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('Production readiness checks passed');
	});

	it('fails closed when production demo mode is enabled', () => {
		const result = runReadiness({ ...validReleaseEnvironment, PUBLIC_DEMO_MODE: 'true' });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('PUBLIC_DEMO_MODE must be false');
	});

	it('fails closed when any billing surface is enabled', () => {
		const enabledBilling = Object.fromEntries(billingFlags.map((flag) => [flag, 'true']));
		const result = runReadiness({ ...validReleaseEnvironment, ...enabledBilling });
		expect(result.status).toBe(1);

		for (const flag of billingFlags) {
			expect(result.stderr).toContain(`${flag} must be false`);
		}
	});
});
