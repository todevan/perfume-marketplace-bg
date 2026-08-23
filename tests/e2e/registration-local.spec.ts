import { expect, test, type Page } from '@playwright/test';

const supabaseUrl = process.env.REGISTRATION_SUPABASE_URL ?? 'http://127.0.0.1:45321';
const mailpitUrl = process.env.REGISTRATION_MAILPIT_URL ?? 'http://127.0.0.1:45324';
const anonKey =
	process.env.REGISTRATION_SUPABASE_ANON_KEY ??
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlLWRlbW8iLCJyb2xlIjoiYW5vbiIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

interface MailpitMessageSummary {
	ID: string;
	To: Array<{ Address: string }>;
}

interface MailpitList {
	messages: MailpitMessageSummary[];
}

interface MailpitMessage {
	HTML: string;
}

function uniqueAccount(): { email: string; password: string; username: string } {
	const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
	return {
		email: `issue22-${suffix}@example.com`,
		password: `Issue22-${suffix}-Safe!`,
		username: `issue22_${suffix}`
	};
}

async function directSignup(body: Record<string, unknown>): Promise<Response> {
	return fetch(`${supabaseUrl}/auth/v1/signup`, {
		method: 'POST',
		headers: {
			apikey: anonKey,
			authorization: `Bearer ${anonKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});
}

async function directPasswordSignup(
	account: ReturnType<typeof uniqueAccount>,
	password: string
): Promise<Response> {
	return directSignup({
		email: account.email,
		password,
		data: { username: account.username },
		gotrue_meta_security: { captcha_token: 'XXXX.DUMMY.TOKEN.XXXX' }
	});
}

async function mailpitMessageIdsFor(email: string): Promise<Set<string>> {
	const response = await fetch(`${mailpitUrl}/api/v1/messages`);
	if (!response.ok) throw new Error(`Mailpit message list returned ${response.status}.`);
	const payload = (await response.json()) as MailpitList;
	return new Set(
		payload.messages
			.filter((message) => message.To.some((recipient) => recipient.Address === email))
			.map((message) => message.ID)
	);
}

async function expectNewMailpitMessage(email: string, existingIds: ReadonlySet<string>): Promise<void> {
	await expect
		.poll(
			async () => {
				const currentIds = await mailpitMessageIdsFor(email);
				return [...currentIds].some((id) => !existingIds.has(id));
			},
			{ message: `new Mailpit message for ${email}`, timeout: 15_000 }
		)
		.toBe(true);
}

async function installTestingCaptchaToken(page: Page): Promise<void> {
	await page.locator('.cf-turnstile').evaluate((host) => {
		const input =
			host.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]') ??
			document.createElement('input');
		if (!input.isConnected) {
			input.type = 'hidden';
			input.name = 'cf-turnstile-response';
			host.append(input);
		}
		input.value = 'XXXX.DUMMY.TOKEN.XXXX';
	});
}

async function confirmationLinkFor(email: string): Promise<string> {
	let messageId: string | undefined;
	await expect
		.poll(
			async () => {
				const response = await fetch(`${mailpitUrl}/api/v1/messages`);
				if (!response.ok) return false;
				const payload = (await response.json()) as MailpitList;
				messageId = payload.messages.find((message) =>
					message.To.some((recipient) => recipient.Address === email)
				)?.ID;
				return Boolean(messageId);
			},
			{ message: `confirmation email for ${email}`, timeout: 15_000 }
		)
		.toBe(true);

	const response = await fetch(`${mailpitUrl}/api/v1/message/${messageId}`);
	if (!response.ok) throw new Error(`Mailpit message lookup returned ${response.status}.`);
	const message = (await response.json()) as MailpitMessage;
	const href = message.HTML.match(/href="([^"]+)"/u)?.[1]?.replaceAll('&amp;', '&');
	if (!href) throw new Error('Confirmation email did not contain a link.');
	return href;
}

test.describe('open registration against local Supabase', () => {
	test('Supabase Auth rejects direct signup without a valid CAPTCHA shape', async () => {
		const missing = uniqueAccount();
		const missingResponse = await directSignup({
			email: missing.email,
			password: missing.password,
			data: { username: missing.username }
		});
		expect(missingResponse.status).toBe(400);
		expect(await missingResponse.text()).toContain('captcha');

		const malformed = uniqueAccount();
		const malformedResponse = await directSignup({
			email: malformed.email,
			password: malformed.password,
			data: { username: malformed.username },
			gotrue_meta_security: { captcha_token: { forged: true } }
		});
		expect(malformedResponse.status).toBe(400);
		expect(await malformedResponse.text()).toContain('captcha_token');
	});

	test('Supabase Auth enforces the 12-character password boundary on direct signup', async () => {
		const tooShort = uniqueAccount();
		const tooShortResponse = await directPasswordSignup(tooShort, 'Abcdefgh1!x');
		expect(tooShortResponse.status).toBe(422);
		expect(await tooShortResponse.text()).toContain('weak_password');

		const accepted = uniqueAccount();
		const acceptedResponse = await directPasswordSignup(accepted, 'Abcdefgh1!xy');
		expect(acceptedResponse.status).toBe(200);
	});

	test('browser registration, fresh login, and password recovery work through GoTrue CAPTCHA', async ({
		page
	}) => {
		test.setTimeout(60_000);
		const account = uniqueAccount();

		await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
		await page.goto('/login?next=%2Fdashboard');
		await page.getByRole('button', { name: 'Нова регистрация' }).click();
		await page.getByLabel('Потребителско име').fill(account.username);
		await page.getByLabel('Имейл').fill(account.email);
		await page.locator('#password').fill(account.password);
		await page.getByLabel(/навършил/iu).check();
		await installTestingCaptchaToken(page);
		await page.getByRole('button', { name: 'Създай профил' }).click();
		await expect(page.getByRole('status')).toContainText('Провери имейла си');

		await page.goto('/dashboard');
		await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/u);

		const confirmationLink = await confirmationLinkFor(account.email);
		const generated = new URL(confirmationLink);
		expect(generated.origin).toBe('http://127.0.0.1:5173');
		expect(generated.pathname).toBe('/auth/confirm');
		expect(generated.searchParams.get('type')).toBe('email');
		expect(generated.searchParams.get('token_hash')).toMatch(/^[A-Za-z0-9_-]+$/u);

		await page.goto(confirmationLink);
		await expect(page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);

		await page.goto('/dashboard');
		await expect(page).toHaveURL(/\/onboarding\?next=%2Fdashboard$/u);
		await page.getByLabel('Град').fill('  Sofia  ');
		for (const checkbox of await page.locator('fieldset input[type="checkbox"]').all()) {
			await checkbox.check();
		}
		await page.getByRole('button', { name: 'Активирай достъпа' }).click();
		await expect(page).toHaveURL(/\/dashboard$/u);
		await expect(page.getByRole('heading', { name: `Здравей, ${account.username}.` })).toBeVisible();

		await page.getByRole('button', { name: 'Изход', exact: true }).click();
		await expect(page).toHaveURL(/\/login$/u);
		await page.getByLabel('Имейл').fill(account.email);
		await page.locator('#password').fill(account.password);
		await installTestingCaptchaToken(page);
		await page.getByRole('button', { name: 'Влез в профила' }).click();
		await expect(page).toHaveURL(/\/dashboard$/u);
		await expect(page.getByRole('heading', { name: `Здравей, ${account.username}.` })).toBeVisible();

		const previousMessageIds = await mailpitMessageIdsFor(account.email);
		await page.goto('/auth/reset-password');
		await page.getByLabel('Имейл').fill(account.email);
		await installTestingCaptchaToken(page);
		await page.getByRole('button', { name: 'Изпрати връзка' }).click();
		await expect(page.getByRole('status')).toContainText('ще получиш връзка');
		await expectNewMailpitMessage(account.email, previousMessageIds);
	});
});
