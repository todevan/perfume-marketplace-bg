import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { GET as getRobots } from '../../src/routes/robots.txt/+server';
import { GET as getSitemap } from '../../src/routes/sitemap.xml/+server';

const workspace = resolve(import.meta.dirname, '../..');
const readinessScript = resolve(workspace, 'scripts/check-production-readiness.mjs');
const deploymentWorkflowPath = resolve(workspace, '.github/workflows/deploy.yml');
const qualityWorkflowPath = resolve(workspace, '.github/workflows/ci.yml');
const packageJsonPath = resolve(workspace, 'package.json');
const svelteConfigPath = resolve(workspace, 'svelte.config.js');
type WorkflowStep = {
	name?: string;
	id?: string;
	if?: string;
	uses?: string;
	run?: string;
	env?: Record<string, string>;
};
type WorkflowJob = {
	if?: string;
	environment?: unknown;
	env?: Record<string, string>;
	steps: WorkflowStep[];
};
type Workflow = {
	on: Record<string, unknown>;
	permissions?: Record<string, string>;
	concurrency?: {
		group?: string;
		'cancel-in-progress'?: boolean;
	};
	jobs: Record<string, WorkflowJob>;
};
const deploymentWorkflow = parse(readFileSync(deploymentWorkflowPath, 'utf8')) as Workflow;
const qualityWorkflow = parse(readFileSync(qualityWorkflowPath, 'utf8')) as Workflow;

function runCommands(job: WorkflowJob): string[] {
	return job.steps.flatMap((step) => (step.run ? [step.run] : []));
}
const billingFlags = [
	'FEATURE_BILLING_ENABLED',
	'FEATURE_LISTING_FEES_ENABLED',
	'FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED',
	'FEATURE_BOOSTS_ENABLED',
	'FEATURE_DIRECT_ADS_ENABLED',
	'FEATURE_MYPOS_PAYMENTS_ENABLED',
	'FEATURE_STRIPE_FALLBACK_ENABLED'
] as const;

const activeFrankfurtPublishableKeySha256 =
	'e3a86494076813f116a5d87efd8476397f9c572a0d6bf71d1e1497a285331bfb';

const validReleaseEnvironment: NodeJS.ProcessEnv = {
	...process.env,
	APP_ENV: 'production',
	PUBLIC_DEMO_MODE: 'false',
	PRIVATE_BETA_REQUIRE_STAFF_MFA: 'true',
	LEGAL_CONTENT_APPROVED: 'true',
	PAYMENT_PROVIDER: 'disabled',
	IMAGE_PROCESSOR_MODE: 'cloudflare-images',
	PUBLIC_APP_URL: 'https://perfume.example.com',
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	EXPECTED_PRODUCTION_APP_HOST: 'perfume.example.com',
	EXPECTED_SUPABASE_PROJECT_REF: 'example',
	RELEASE_COMMIT_SHA: 'c'.repeat(40),
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_release_test_key',
	SUPABASE_SECRET_KEY: 'sb_secret_release_test_key',
	TERMS_VERSION: '2026-07-26',
	PRIVACY_VERSION: '2026-07-26',
	MARKETPLACE_RULES_VERSION: '2026-07-26',
	INCIDENT_CONTACT_EMAIL: 'incidents@example.com',
	LEGAL_CONTROLLER_NAME: 'Perfume Marketplace Bulgaria AD',
	LEGAL_CONTROLLER_REGISTRATION: 'BG123456789',
	LEGAL_CONTROLLER_ADDRESS: 'Sofia 1000, Bulgaria',
	PRIVACY_CONTACT_EMAIL: 'privacy@perfume-market.bg',
	APPEALS_CONTACT_EMAIL: 'appeals@perfume-market.bg',
	LEGAL_APPROVAL_REFERENCE: 'BG-LEGAL-2026-07-29',
	RESEND_API_KEY: 're_test_key',
	RESEND_FROM_EMAIL: 'Marketplace <notifications@example.com>',
	TURNSTILE_SECRET_KEY: 'turnstile-secret-key-production',
	PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site-key-production',
	TURNSTILE_EXPECTED_HOSTNAME: 'perfume.example.com',
	CLOUDFLARE_ACCOUNT_ID: '3'.repeat(32),
	CLOUDFLARE_IMAGES_API_TOKEN: 'cloudflare-images-token-production',
	NOTIFICATION_WEBHOOK_SECRET: 'n'.repeat(32),
	UPLOAD_CLEANUP_SECRET: 'u'.repeat(32),
	HOSTED_CRON_INVENTORY_SHA256: 'a'.repeat(64),
	PROVIDER_ATTESTATION_SHA256: 'b'.repeat(64)
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

describe('pre-launch deployment hardening', () => {
	it('keeps deployment manual, staging-only, and guarded to main', () => {
		expect(Object.keys(deploymentWorkflow.on)).toEqual(['workflow_dispatch']);
		expect(Object.keys(deploymentWorkflow.jobs)).toEqual(['staging']);
		expect(deploymentWorkflow.permissions).toEqual({ contents: 'read', checks: 'read' });
		expect(deploymentWorkflow.concurrency).toEqual({
			group: 'deploy-staging',
			'cancel-in-progress': false
		});
		expect(deploymentWorkflow.jobs.staging.if).toBe("github.ref == 'refs/heads/main'");
		expect(deploymentWorkflow.jobs.staging).not.toHaveProperty('environment');
		expect(runCommands(deploymentWorkflow.jobs.staging)).not.toContain(
			expect.stringContaining('--env=""')
		);
	});

	it('uses repository secrets and validates staging before the only deploy step', () => {
		const job = deploymentWorkflow.jobs.staging;
		const commands = runCommands(job);
		const ciGate = job.steps.find(
			(step) => step.name === 'Require successful complete CI for the exact SHA'
		);
		const installStep = job.steps.findIndex(
			(step) => step.run === 'pnpm install --frozen-lockfile'
		);
		expect(job.env).toMatchObject({ EXPECTED_GIT_SHA: '${{ github.sha }}' });
		expect(JSON.stringify(deploymentWorkflow)).not.toContain('${{ vars.');
		expect(ciGate).toMatchObject({
			run: 'node scripts/verify-ci-checks.mjs',
			env: { GITHUB_TOKEN: '${{ github.token }}' }
		});
		expect(job.steps.indexOf(ciGate!)).toBeLessThan(installStep);
		const deployStep = job.steps.find((step) => step.id === 'deploy');
		expect(deployStep?.env).toEqual({
			CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
			CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}'
		});

		const install = commands.indexOf('pnpm install --frozen-lockfile');
		const productionAudit = commands.indexOf('pnpm audit --prod');
		const highAudit = commands.indexOf('pnpm audit --audit-level high');
		const tests = commands.indexOf('pnpm test');
		const dryRun = commands.indexOf('pnpm exec wrangler deploy --dry-run --env staging');
		const deploy = commands.indexOf('pnpm exec wrangler deploy --env staging');

		expect(install).toBeGreaterThan(-1);
		expect(productionAudit).toBeGreaterThan(install);
		expect(highAudit).toBeGreaterThan(productionAudit);
		expect(tests).toBeGreaterThan(highAudit);
		expect(dryRun).toBeGreaterThan(tests);
		expect(deploy).toBeGreaterThan(dryRun);
		expect(commands.filter((command) => command === 'pnpm exec wrangler deploy --env staging')).toHaveLength(
			1
		);
	});

	it('accepts exact-SHA quality checks only from GitHub Actions', () => {
		const verifier = readFileSync(resolve(workspace, 'scripts/verify-ci-checks.mjs'), 'utf8');
		expect(verifier).toContain("check?.app?.slug === 'github-actions'");
		expect(verifier).toContain("check?.head_sha === sha");
		expect(verifier).toContain("check?.status === 'completed'");
		expect(verifier).toContain("check?.conclusion === 'success'");
	});

	it('installs every browser engine used by the Playwright project matrix', () => {
		expect(runCommands(qualityWorkflow.jobs.app)).toContain(
			'pnpm exec playwright install --with-deps chromium'
		);
	});

	it('keeps Cloudflare platform emulation ephemeral during Vite preview', () => {
		const svelteConfig = readFileSync(svelteConfigPath, 'utf8');
		expect(svelteConfig).toMatch(
			/platformProxy:\s*\{\s*[\s\S]*?persist:\s*false/
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

	it('pins the Frankfurt development runtime without committing server secrets', () => {
		const wrangler = JSON.parse(readFileSync(resolve(workspace, 'wrangler.jsonc'), 'utf8'));
		const variables = wrangler.env.staging.vars as Record<string, string>;
		expect(wrangler.env.staging.secrets).toEqual({
			required: ['SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY']
		});

		expect(variables).toMatchObject({
			APP_ENV: 'staging',
			PUBLIC_DEMO_MODE: 'false',
			PUBLIC_APP_URL:
				'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev',
			PUBLIC_SUPABASE_URL: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
			PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
			TURNSTILE_EXPECTED_HOSTNAME:
				'perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev',
			PRIVATE_BETA_REQUIRE_STAFF_MFA: 'true',
			LEGAL_CONTENT_APPROVED: 'false',
			IMAGE_PROCESSOR_MODE: 'cloudflare-images',
			FEATURE_BILLING_ENABLED: 'false',
			FEATURE_LISTING_FEES_ENABLED: 'false',
			FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED: 'false',
			FEATURE_BOOSTS_ENABLED: 'false',
			FEATURE_DIRECT_ADS_ENABLED: 'false',
			FEATURE_MYPOS_PAYMENTS_ENABLED: 'false',
			FEATURE_STRIPE_FALLBACK_ENABLED: 'false',
			PAYMENT_PROVIDER: 'disabled'
		});
		expect(variables.PUBLIC_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/);
		expect(
			createHash('sha256')
				.update(variables.PUBLIC_SUPABASE_PUBLISHABLE_KEY)
				.digest('hex')
		).toBe(activeFrankfurtPublishableKeySha256);
		expect(variables).not.toHaveProperty('SUPABASE_SECRET_KEY');
		expect(variables).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
		expect(variables).not.toHaveProperty('TURNSTILE_SECRET_KEY');
		expect(variables).not.toHaveProperty('UPLOAD_CLEANUP_SECRET');
	});

	it('blocks release while legal routes still contain draft markers', () => {
		const result = runReadiness();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('still contains draft or placeholder legal copy');
	});

	it('rejects opaque hashes unless fresh, identity-bound receipt files are present', () => {
		const receiptDirectory = mkdtempSync(join(tmpdir(), 'release-receipts-'));
		const hostedPath = join(receiptDirectory, 'hosted.json');
		const providerPath = join(receiptDirectory, 'providers.json');
		const checkedAt = new Date().toISOString();
		const hostedContents = `${JSON.stringify({
			schemaVersion: 1,
			kind: 'hosted-runtime-inventory',
			checkedAt,
			commitSha: 'd'.repeat(40),
			projectRef: 'example',
			inventory: {}
		})}\n`;
		const checkResult = {
			passed: true,
			checkedAt,
			evidenceSha256: 'e'.repeat(64)
		};
		const providerContents = `${JSON.stringify({
			schemaVersion: 1,
			kind: 'production-provider-attestation',
			checkedAt,
			commitSha: 'd'.repeat(40),
			productionAppHost: 'perfume.example.com',
			supabaseProjectRef: 'example',
			cloudflareAccountId: '3'.repeat(32),
			checks: {
				cloudflareImages: checkResult,
				notificationWebhook: checkResult,
				resendEmail: checkResult,
				supabaseAuth: checkResult,
				turnstile: checkResult,
				uploadCleanup: checkResult
			}
		})}\n`;

		try {
			writeFileSync(hostedPath, hostedContents);
			writeFileSync(providerPath, providerContents);
			const result = runReadiness({
				...validReleaseEnvironment,
				HOSTED_RUNTIME_INVENTORY_RECEIPT_PATH: hostedPath,
				HOSTED_CRON_INVENTORY_SHA256: createHash('sha256')
					.update(hostedContents)
					.digest('hex'),
				PROVIDER_ATTESTATION_RECEIPT_PATH: providerPath,
				PROVIDER_ATTESTATION_SHA256: createHash('sha256')
					.update(providerContents)
					.digest('hex')
			});

			expect(result.status).toBe(1);
			expect(result.stderr).toContain(
				'hosted runtime receipt commitSha does not match RELEASE_COMMIT_SHA'
			);
			expect(result.stderr).toContain(
				'provider attestation commitSha does not match RELEASE_COMMIT_SHA'
			);
		} finally {
			rmSync(receiptDirectory, { recursive: true, force: true });
		}
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
