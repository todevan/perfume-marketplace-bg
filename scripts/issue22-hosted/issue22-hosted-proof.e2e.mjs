import { expect, test } from '@playwright/test';
import {
	Issue22RunnerError,
	assertRuntimeCandidate,
	pollForConfirmationMessage,
	runHostedJourney,
	validateRunnerEnvironment
} from './runner.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Response} PlaywrightResponse */

const NAVIGATION_TIMEOUT_MS = 30_000;
const TURNSTILE_TIMEOUT_MS = 30_000;
const REQUIRED_CONSENTS = Object.freeze([
	'consent_age_18_confirmation',
	'consent_beta_terms',
	'consent_marketplace_rules',
	'consent_privacy_notice'
]);

/**
 * @param {string} message
 * @returns {never}
 */
function failSafely(message) {
	throw new Issue22RunnerError(message);
}

/**
 * @param {string} origin
 * @param {string} path
 */
function candidateUrl(origin, path) {
	return new URL(path, `${origin}/`).href;
}

/**
 * @param {Page} page
 * @param {string} origin
 * @param {string} path
 */
async function gotoCandidate(page, origin, path) {
	let response;
	try {
		response = await page.goto(candidateUrl(origin, path), {
			waitUntil: 'domcontentloaded',
			timeout: NAVIGATION_TIMEOUT_MS
		});
	} catch {
		failSafely('Issue #22 candidate navigation failed safely.');
	}
	if (!response?.ok() || new URL(page.url()).origin !== origin) {
		failSafely('Issue #22 candidate navigation failed safely.');
	}
}

/** @param {Page} page */
async function waitForTurnstile(page) {
	const host = page.locator('.cf-turnstile');
	await expect(host, 'Registration must render exactly one Turnstile widget').toHaveCount(1, {
		timeout: TURNSTILE_TIMEOUT_MS
	});
	const response = page.locator('input[name="cf-turnstile-response"]');
	await expect(response).toHaveCount(1, { timeout: TURNSTILE_TIMEOUT_MS });
	await expect
		.poll(() => response.inputValue(), {
			message: 'Registration Turnstile did not issue a single-use response',
			timeout: TURNSTILE_TIMEOUT_MS
		})
		.toMatch(/\S/u);
}

/**
 * @param {Page} page
 * @param {{ recipient: string; password: string; username: string }} identity
 */
async function fillRegistration(page, identity) {
	await page.getByLabel('Потребителско име').fill(identity.username);
	await page.getByLabel('Имейл').fill(identity.recipient);
	await page.getByLabel('Парола', { exact: true }).fill(identity.password);
	await page.getByRole('checkbox', { name: /18 години/u }).check();
}

/**
 * @param {PlaywrightResponse} response
 * @param {string} origin
 * @param {string} expectedPath
 */
function assertCleanConfirmationRedirect(response, origin, expectedPath) {
	const headers = response.headers();
	const location = headers.location;
	let redirect;
	try {
		redirect = new URL(location, `${origin}/`);
	} catch {
		failSafely('Issue #22 confirmation redirect was not sanitized.');
	}
	if (
		response.status() !== 303 ||
		redirect.origin !== origin ||
		redirect.pathname !== expectedPath ||
		redirect.search ||
		redirect.hash ||
		!headers['cache-control']?.split(',').some((directive) => directive.trim() === 'no-store') ||
		headers['referrer-policy'] !== 'no-referrer'
	) {
		failSafely('Issue #22 confirmation redirect was not sanitized.');
	}
}

/**
 * Navigate a token-bearing link without ever placing it in a diagnostic or artifact.
 * @param {Page} page
 * @param {string} link
 * @param {string} origin
 * @param {string} expectedPath
 */
async function followConfirmation(page, link, origin, expectedPath) {
	const responsePromise = page.waitForResponse(
		(response) => {
			try {
				const url = new URL(response.url());
				return (
					url.origin === origin &&
					url.pathname === '/auth/confirm' &&
					url.searchParams.has('token_hash') &&
					url.searchParams.get('type') === 'email'
				);
			} catch {
				return false;
			}
		},
		{ timeout: NAVIGATION_TIMEOUT_MS }
	);

	let response;
	try {
		[response] = await Promise.all([
			responsePromise,
			page.goto(link, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
		]);
		await page.waitForURL(
			(url) =>
				url.origin === origin &&
				url.pathname === expectedPath &&
				url.search.length === 0 &&
				url.hash.length === 0,
			{ timeout: NAVIGATION_TIMEOUT_MS }
		);
	} catch {
		failSafely('Issue #22 confirmation navigation failed safely.');
	}

	assertCleanConfirmationRedirect(response, origin, expectedPath);
	return { redirectedTo: expectedPath };
}

test('Issue #22 hosted registration proof', async ({ browser }) => {
	test.setTimeout(150_000);
	const config = validateRunnerEnvironment();
	await assertRuntimeCandidate(candidateUrl(config.candidateOrigin, '/login'), config.expectedSha);

	const primaryContext = await browser.newContext();
	const replayContext = await browser.newContext();
	const forgeryContext = await browser.newContext();
	const primary = await primaryContext.newPage();
	const replay = await replayContext.newPage();
	const forgery = await forgeryContext.newPage();
	primary.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
	replay.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
	forgery.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

	try {
		const result = await runHostedJourney(config, {
			now: Date.now,
			assertForgedCaptchaRejected: async (identity) => {
				await gotoCandidate(forgery, config.candidateOrigin, '/login');
				await forgery.getByRole('button', { name: 'Нова регистрация', exact: true }).click();
				await expect(forgery.getByRole('heading', { name: 'Създай профил.' })).toBeVisible();
				await fillRegistration(forgery, identity);
				await waitForTurnstile(forgery);
				await forgery.locator('input[name="cf-turnstile-response"]').evaluate((element) => {
					/** @type {HTMLInputElement} */ (element).value = 'issue22-forged-turnstile-token';
				});
				const responsePromise = forgery.waitForResponse(
					(response) => {
						const url = new URL(response.url());
						return (
							response.request().method() === 'POST' &&
							url.origin === config.candidateOrigin &&
							url.pathname === '/login' &&
							url.search === '?/register'
						);
					},
					{ timeout: NAVIGATION_TIMEOUT_MS }
				);
				const [response] = await Promise.all([
					responsePromise,
					forgery.getByRole('button', { name: 'Създай профил', exact: true }).click()
				]);
				if (response.status() < 400) {
					failSafely('Issue #22 forged CAPTCHA token was not denied.');
				}
				await expect(forgery.getByRole('alert')).toHaveText(
					'Профилът не можа да бъде създаден. Провери данните или опитай по-късно.'
				);
				await expect(forgery.getByRole('status')).toHaveCount(0);
				return { denied: true };
			},
			signup: async (identity) => {
				await gotoCandidate(primary, config.candidateOrigin, '/login');
				await primary.getByRole('button', { name: 'Нова регистрация', exact: true }).click();
				await expect(primary.getByRole('heading', { name: 'Създай профил.' })).toBeVisible();
				await fillRegistration(primary, identity);
				await waitForTurnstile(primary);
				await primary.getByRole('button', { name: 'Създай профил', exact: true }).click();
				await expect(primary.getByRole('status')).toHaveText(
					'Провери имейла си и потвърди регистрацията, за да завършиш профила.'
				);
			},
			poll: (pollConfig) => pollForConfirmationMessage(pollConfig),
			confirm: async (link) => {
				const confirmation = await followConfirmation(
					primary,
					link,
					config.candidateOrigin,
					'/onboarding'
				);
				await expect(primary.getByRole('heading', { name: 'Завърши профила си.' })).toBeVisible();
				return confirmation;
			},
			completeOnboarding: async ({ username, city }) => {
				await primary.getByLabel('Потребителско име').fill(username);
				await primary.getByLabel('Град').fill(city);
				const consentInputs = primary.locator('input[type="checkbox"][name^="consent_"]');
				const consentNames = await consentInputs.evaluateAll((elements) =>
					elements.map((element) => element.getAttribute('name')).sort()
				);
				expect(consentNames).toEqual(REQUIRED_CONSENTS);
				for (const consent of await consentInputs.all()) await consent.check();
				await Promise.all([
					primary.waitForURL(
						(url) =>
							url.origin === config.candidateOrigin &&
							url.pathname === '/dashboard' &&
							url.search.length === 0,
						{ timeout: NAVIGATION_TIMEOUT_MS }
					),
					primary.getByRole('button', { name: 'Активирай достъпа', exact: true }).click()
				]);
				await expect(primary.getByRole('heading', { name: `Здравей, ${username}.` })).toBeVisible();
				await expect(primary.getByText(`Град: ${city}`, { exact: true })).toBeVisible();
			},
			assertMarketplaceAccess: async () => {
				await gotoCandidate(primary, config.candidateOrigin, '/listings');
				if (new URL(primary.url()).pathname !== '/listings') {
					failSafely('Issue #22 marketplace access was not active.');
				}
				await expect(primary.getByRole('heading', { name: 'Обяви', exact: true })).toBeVisible();
				await expect(primary.getByRole('link', { name: 'Публикувай обява', exact: true })).toBeVisible();
			},
			reuseConfirmationLink: async (link) => {
				await followConfirmation(replay, link, config.candidateOrigin, '/auth/error');
				await expect(
					replay.getByRole('heading', { name: 'Връзката не беше потвърдена.' })
				).toBeVisible();
				await gotoCandidate(replay, config.candidateOrigin, '/dashboard');
				if (new URL(replay.url()).pathname !== '/login') {
					failSafely('Issue #22 confirmation replay created an authenticated session.');
				}
				return { denied: true };
			}
		});

		expect(result).toEqual({
			status: 'passed',
			candidateSha: config.expectedSha,
			signupCount: 1,
			mailCount: 1,
			captchaForgery: 'denied',
			confirmationReuse: 'denied'
		});
	} finally {
		await Promise.all([primaryContext.close(), replayContext.close(), forgeryContext.close()]);
	}
});
