import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerClient } from '@supabase/ssr';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import type { Database } from '../../src/lib/server/database.types';

const origin = 'https://perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev';
const projectRef = 'zzrrutwlrkhevellwork';
const supabaseUrl = `https://${projectRef}.supabase.co`;
const publishableKey = 'sb_publishable_1imlAP3Eanrj-jXL1bpcTQ_rVKnHXUy';
const ledger = process.env.ISSUE22_LEDGER_PATH!;
const etherealUser = process.env.ETHEREAL_USER!;
const etherealPass = process.env.ETHEREAL_PASS!;
const here = dirname(fileURLToPath(import.meta.url));

function record(event: object) {
	const fd = openSync(ledger, 'a');
	try {
		appendFileSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function account(label: string) {
	const nonce = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
	return {
		label,
		email: `issue22-${label}-${nonce}@example.invalid`,
		username: `issue22_${label}_${nonce}`,
		password: `Issue22-${nonce}-Safe!`
	};
}

async function waitForRealTurnstile(context: BrowserContext) {
	const page = context.pages()[0];
	await expect.poll(
		async () => page.locator('input[name="cf-turnstile-response"]').inputValue().catch(() => ''),
		{ timeout: 60_000, message: 'real hostname-bound Turnstile browser token' }
	).toMatch(/^.{20,}$/u);
}

function confirmationLink(email: string) {
	const result = spawnSync('python', [join(here, 'ethereal-link.py')], {
		encoding: 'utf8',
		env: { ...process.env, ETHEREAL_USER: etherealUser, ETHEREAL_PASS: etherealPass, ISSUE22_RECIPIENT: email }
	});
	if (result.status !== 0) throw new Error('Ethereal confirmation retrieval failed without credential disclosure');
	return result.stdout.trim();
}

async function clientFromConfirmedBrowser(context: BrowserContext) {
	const browserCookies = await context.cookies(origin);
	const supabase = createServerClient<Database>(supabaseUrl, publishableKey, {
		cookies: {
			getAll: async () => browserCookies.map(({ name, value }) => ({ name, value })),
			setAll: async () => { throw new Error('hosted evidence must not refresh or replace the captured browser session'); }
		}
	});
	const userResult = await supabase.auth.getUser();
	if (userResult.error || !userResult.data.user) throw new Error('confirmed browser SSR session did not validate');
	return { client: supabase, user: userResult.data.user };
}

async function registerAndOnboard(browser: Browser, label: string) {
	const actor = account(label);
	record({ event: 'create_intent', label, email: actor.email, username: actor.username });
	const context = await browser.newContext();
	let workerRequests = 0;
	context.on('request', (request) => { if (request.url().startsWith(`${origin}/`)) workerRequests += 1; });
	const page = await context.newPage();
	await page.goto(`${origin}/login?next=%2Fdashboard`);
	await page.getByRole('button', { name: 'Нова регистрация' }).click();
	await page.getByLabel('Потребителско име').fill(actor.username);
	await page.getByLabel('Имейл').fill(actor.email);
	await page.locator('#password').fill(actor.password);
	await page.getByLabel(/навършил/iu).check();
	await waitForRealTurnstile(context);
	await page.getByRole('button', { name: 'Създай профил' }).click();
	await expect(page.getByRole('status')).toContainText('Провери имейла си');
	await page.goto(`${origin}/dashboard`);
	await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/u);
	const link = confirmationLink(actor.email);
	record({ event: 'confirmation_link_shape', label, type: 'email', origin });
	await page.goto(link);
	await expect(page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);
	const { client, user } = await clientFromConfirmedBrowser(context);
	record({ event: 'actor_bound', label, email: actor.email, username: actor.username, userId: user.id });
	expect(user.phone ?? '').toBe('');
	const pending = await client.from('beta_memberships').select('status,onboarding_completed_at').eq('profile_id', user.id).single();
	expect(pending.error).toBeNull();
	expect(pending.data).toMatchObject({ status: 'pending', onboarding_completed_at: null });
	await page.goto(`${origin}/dashboard`);
	await expect(page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);
	await page.getByLabel('Град').fill(label === 'a' ? 'София' : 'Saint-Rémy');
	for (const checkbox of await page.locator('fieldset input[type="checkbox"]').all()) await checkbox.check();
	await page.getByRole('button', { name: 'Активирай достъпа' }).click();
	await expect(page).toHaveURL(`${origin}/dashboard`);
	return { actor, context, page, client, userId: user.id, workerRequestCount: () => workerRequests };
}

test('real hosted registration and hostile R2 boundaries', async ({ browser }) => {
	test.setTimeout(240_000);
	const direct = async (actor: ReturnType<typeof account>, captchaToken?: string) => {
		record({ event: 'create_intent', label: actor.label, email: actor.email, username: actor.username });
		return fetch(`${supabaseUrl}/auth/v1/signup`, {
			method: 'POST',
			headers: { apikey: publishableKey, authorization: `Bearer ${publishableKey}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				email: actor.email,
				password: actor.password,
				data: { username: actor.username },
				...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {})
			})
		});
	};
	for (const response of [await direct(account('missing_captcha')), await direct(account('invalid_captcha'), 'invalid')]) {
		expect(response.status).toBe(400);
		const error = await response.json() as { error_code?: string };
		expect(error.error_code).toBe('captcha_failed');
	}

	const a = await registerAndOnboard(browser, 'a');
	const b = await registerAndOnboard(browser, 'b');
	try {
		const crossProfile = await a.client.from('profiles').update({ city: 'Sofia' }).eq('id', b.userId).select('id');
		expect(crossProfile.error).toBeNull();
		expect(crossProfile.data).toEqual([]);
		const bProfile = await b.client.from('profiles').select('city').eq('id', b.userId).single();
		expect(bProfile.data?.city).toBe('Saint-Rémy');

		const crossMembership = await a.client.from('beta_memberships').update({ status: 'revoked' }).eq('profile_id', b.userId).select('profile_id');
		expect(crossMembership.error).toBeNull();
		expect(crossMembership.data).toEqual([]);
		const bMembership = await b.client.from('beta_memberships').select('status').eq('profile_id', b.userId).single();
		expect(bMembership.data?.status).toBe('active');

		const consentColumns = 'document_code,document_version,accepted_at';
		const requiredDocuments = [
			{ document_code: 'age_18_confirmation', document_version: '2026-07-22' },
			{ document_code: 'beta_terms', document_version: '2026-07-22' },
			{ document_code: 'marketplace_rules', document_version: '2026-07-22' },
			{ document_code: 'privacy_notice', document_version: '2026-07-22' }
		];
		const beforeConsent = await b.client.from('beta_consent_events').select(consentColumns).eq('profile_id', b.userId).order('document_code').order('document_version');
		expect(beforeConsent.error).toBeNull();
		expect(beforeConsent.data?.map(({ document_code, document_version }) => ({ document_code, document_version }))).toEqual(requiredDocuments);
		const crossConsent = await a.client.from('beta_consent_events').delete().eq('profile_id', b.userId).select('profile_id');
		expect(crossConsent.error).toBeNull();
		expect(crossConsent.data).toEqual([]);
		const afterConsent = await b.client.from('beta_consent_events').select(consentColumns).eq('profile_id', b.userId).order('document_code').order('document_version');
		expect(afterConsent.error).toBeNull();
		expect(afterConsent.data).toEqual(beforeConsent.data);

		const escalation = await a.client.from('profiles').update({ role: 'admin' }).eq('id', a.userId);
		expect(escalation.error).not.toBeNull();
		for (const city of ['\u0085\u0085', '\u2060\u2060', '---']) {
			const hostile = await a.client.from('profiles').update({ city }).eq('id', a.userId);
			expect(hostile.error).not.toBeNull();
		}
		const cleared = await a.client.from('profiles').update({ city: null }).eq('id', a.userId);
		expect(cleared.error).toBeNull();
		await a.page.goto(`${origin}/dashboard`);
		await expect(a.page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);
		const restored = await a.client.from('profiles').update({ city: "L'Aquila" }).eq('id', a.userId);
		expect(restored.error).toBeNull();
		await a.page.goto(`${origin}/dashboard`);
		await expect(a.page).toHaveURL(`${origin}/dashboard`);

		for (const actor of [a, b]) {
			const response = await actor.page.request.post(`${origin}/auth/logout`, { headers: { origin } });
			expect(response.ok()).toBe(true);
		}
		const browserWorkerRequests = a.workerRequestCount() + b.workerRequestCount();
		expect(browserWorkerRequests).toBeLessThan(450);
		record({ event: 'worker_request_bound', browserWorkerRequests, totalOperatorMaximum: 587 });
	} finally {
		await a.context.close();
		await b.context.close();
	}
});
