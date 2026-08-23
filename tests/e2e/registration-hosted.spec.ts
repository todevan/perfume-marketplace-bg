import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Database } from '../../src/lib/server/database.types';

interface HostedTarget {
	origin: string;
	supabaseUrl: string;
	publishableKey: string;
	projectRef: string;
	candidateSha: string;
	runId: string;
}

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required hosted-proof environment variable: ${name}`);
	return value;
}

function hostedTarget(): HostedTarget {
	const origin = new URL(required('ISSUE22_HOSTED_ORIGIN'));
	const supabaseUrl = new URL(required('ISSUE22_SUPABASE_URL'));
	const projectRef = required('ISSUE22_SUPABASE_PROJECT_REF');
	const candidateSha = required('ISSUE22_CANDIDATE_SHA');
	const runId = required('ISSUE22_RUN_ID');
	if (origin.protocol !== 'https:' || origin.pathname !== '/') {
		throw new Error('ISSUE22_HOSTED_ORIGIN must be an HTTPS origin without a path.');
	}
	if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== `${projectRef}.supabase.co`) {
		throw new Error('Supabase URL and project ref do not identify the same hosted target.');
	}
	if (!/^[0-9a-f]{40}$/u.test(candidateSha)) {
		throw new Error('ISSUE22_CANDIDATE_SHA must be an exact 40-character Git SHA.');
	}
	if (!/^[a-z0-9-]{3,12}$/u.test(runId)) {
		throw new Error('ISSUE22_RUN_ID must be a 3-12 character lowercase cleanup label.');
	}
	return {
		origin: origin.origin,
		supabaseUrl: supabaseUrl.origin,
		publishableKey: required('ISSUE22_SUPABASE_PUBLISHABLE_KEY'),
		projectRef,
		candidateSha,
		runId
	};
}

function account(target: HostedTarget, label: 'a' | 'b') {
	const nonce = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
	const cleanupLabel = `issue22-${target.runId}-${target.candidateSha.slice(0, 8)}-${label}`;
	return {
		email: `${cleanupLabel}-${nonce}@example.invalid`,
		password: `Issue22-${nonce}-Safe!`,
		username: `i22_${target.runId.slice(0, 6)}_${label}_${nonce}`
	};
}

function confirmationLink(target: HostedTarget, recipient: string): string {
	const result = spawnSync('python', [join(process.cwd(), 'scripts', 'issue22-ethereal-link.py')], {
		encoding: 'utf8',
		env: {
			...process.env,
			ISSUE22_HOSTED_ORIGIN: target.origin,
			ISSUE22_RECIPIENT: recipient,
			ETHEREAL_USER: required('ETHEREAL_USER'),
			ETHEREAL_PASS: required('ETHEREAL_PASS')
		}
	});
	if (result.status !== 0) {
		throw new Error('Ethereal confirmation retrieval failed without credential disclosure.');
	}
	const link = result.stdout.trim();
	const parsed = new URL(link);
	if (
		parsed.origin !== target.origin ||
		parsed.pathname !== '/auth/confirm' ||
		parsed.searchParams.get('type') !== 'email' ||
		!parsed.searchParams.get('token_hash')
	) {
		throw new Error('Ethereal returned an unsafe confirmation link.');
	}
	return link;
}

async function waitForTurnstile(page: Page): Promise<void> {
	await expect
		.poll(() => page.locator('input[name="cf-turnstile-response"]').inputValue().catch(() => ''), {
			timeout: 60_000,
			message: 'hostname-bound Turnstile test token'
		})
		.toMatch(/^.{20,}$/u);
}

async function authenticatedClient(target: HostedTarget, context: BrowserContext) {
	const cookies = await context.cookies(target.origin);
	const client = createServerClient<Database>(target.supabaseUrl, target.publishableKey, {
		cookies: {
			getAll: () => cookies.map(({ name, value }) => ({ name, value })),
			setAll: (_cookies: Array<{ name: string; value: string; options: CookieOptions }>) => {
				throw new Error('Hosted proof must not replace the captured browser session.');
			}
		}
	});
	const result = await client.auth.getUser();
	if (result.error || !result.data.user) throw new Error('Confirmed hosted browser session did not validate.');
	return { client, user: result.data.user };
}

async function registerAndOnboard(browser: Browser, target: HostedTarget, label: 'a' | 'b') {
	const actor = account(target, label);
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`${target.origin}/login?next=%2Fdashboard`);
	await page.getByRole('button', { name: 'Нова регистрация' }).click();
	await page.getByLabel('Потребителско име').fill(actor.username);
	await page.getByLabel('Имейл').fill(actor.email);
	await page.locator('#password').fill(actor.password);
	await page.getByLabel(/навършил/iu).check();
	await waitForTurnstile(page);
	await page.getByRole('button', { name: 'Създай профил' }).click();
	await expect(page.getByRole('status')).toContainText('Провери имейла си');

	await page.goto(`${target.origin}/dashboard`);
	await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/u);
	await page.goto(confirmationLink(target, actor.email));
	await expect(page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);

	const { client, user } = await authenticatedClient(target, context);
	expect(user.phone ?? '').toBe('');
	const pending = await client
		.from('beta_memberships')
		.select('status,onboarding_completed_at,invite_id')
		.eq('profile_id', user.id)
		.single();
	expect(pending.error).toBeNull();
	expect(pending.data).toMatchObject({ status: 'pending', onboarding_completed_at: null, invite_id: null });
	await page.goto(`${target.origin}/dashboard`);
	await expect(page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);

	for (const checkbox of await page.locator('fieldset input[type="checkbox"]').all()) await checkbox.check();
	await page.getByRole('button', { name: 'Активирай достъпа' }).click();
	await expect(page).toHaveURL(/\/onboarding/u);
	await page.getByLabel('Град').fill('---');
	await page.getByRole('button', { name: 'Активирай достъпа' }).click();
	await expect(page).toHaveURL(/\/onboarding/u);

	await page.getByLabel('Град').fill(label === 'a' ? 'София' : 'Saint-Rémy');
	await page.getByRole('button', { name: 'Активирай достъпа' }).click();
	await expect(page).toHaveURL(`${target.origin}/dashboard`);
	await expect(page.getByRole('heading', { name: `Здравей, ${actor.username}.` })).toBeVisible();
	const consents = await client
		.from('beta_consent_events')
		.select('document_code,document_version')
		.eq('profile_id', user.id)
		.order('document_code');
	expect(consents.error).toBeNull();
	expect(consents.data).toEqual([
		{ document_code: 'age_18_confirmation', document_version: '2026-07-22' },
		{ document_code: 'beta_terms', document_version: '2026-07-22' },
		{ document_code: 'marketplace_rules', document_version: '2026-07-22' },
		{ document_code: 'privacy_notice', document_version: '2026-07-22' }
	]);
	return { actor, context, page, client, userId: user.id };
}

test('exact-target hosted registration and hostile R2 boundaries', async ({ browser }) => {
	test.setTimeout(360_000);
	const target = hostedTarget();

	for (const captchaToken of [undefined, 'invalid']) {
		const actor = account(target, captchaToken ? 'b' : 'a');
		const response = await fetch(`${target.supabaseUrl}/auth/v1/signup`, {
			method: 'POST',
			headers: {
				apikey: target.publishableKey,
				authorization: `Bearer ${target.publishableKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				email: actor.email,
				password: actor.password,
				data: { username: actor.username },
				...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {})
			})
		});
		expect(response.status).toBe(400);
		expect((await response.text()).toLowerCase()).toContain('captcha');
	}

	const a = await registerAndOnboard(browser, target, 'a');
	const b = await registerAndOnboard(browser, target, 'b');
	try {
		const crossProfile = await a.client.from('profiles').update({ city: 'Sofia' }).eq('id', b.userId).select('id');
		expect(crossProfile.error).toBeNull();
		expect(crossProfile.data).toEqual([]);
		const bProfile = await b.client.from('profiles').select('city').eq('id', b.userId).single();
		expect(bProfile.error).toBeNull();
		expect(bProfile.data?.city).toBe('Saint-Rémy');

		const crossMembership = await a.client
			.from('beta_memberships')
			.update({ status: 'revoked' })
			.eq('profile_id', b.userId)
			.select('profile_id');
		expect(crossMembership.error).toBeNull();
		expect(crossMembership.data).toEqual([]);
		const bMembership = await b.client
			.from('beta_memberships')
			.select('status')
			.eq('profile_id', b.userId)
			.single();
		expect(bMembership.error).toBeNull();
		expect(bMembership.data?.status).toBe('active');

		const escalation = await a.client.from('profiles').update({ role: 'admin' }).eq('id', a.userId);
		expect(escalation.error).not.toBeNull();
		for (const city of ['\u0085\u0085', '\u2060\u2060', '---']) {
			const hostile = await a.client.from('profiles').update({ city }).eq('id', a.userId);
			expect(hostile.error).not.toBeNull();
		}

		const cleared = await a.client.from('profiles').update({ city: null }).eq('id', a.userId);
		expect(cleared.error).toBeNull();
		await a.page.goto(`${target.origin}/dashboard`);
		await expect(a.page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);
		const restored = await a.client.from('profiles').update({ city: "L'Aquila" }).eq('id', a.userId);
		expect(restored.error).toBeNull();
		await a.page.goto(`${target.origin}/dashboard`);
		await expect(a.page).toHaveURL(`${target.origin}/dashboard`);
	} finally {
		await Promise.all([a.context.close(), b.context.close()]);
	}
});
