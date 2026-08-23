import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Destructive staging/production smoke test.
 *
 * It is intentionally inert unless E2E_REAL_RUN=true. The target environment
 * must use Cloudflare Turnstile's always-pass testing keys: automation must not
 * bypass or attempt to solve a live CAPTCHA. All three users must already be
 * active marketplace members; seller and buyer use ordinary email/password
 * accounts, while the moderator must have an enrolled TOTP factor and a
 * moderator/admin role.
 *
 * Required for the marketplace flow:
 *   E2E_REAL_RUN=true
 *   E2E_REAL_BASE_URL=https://staging.example.bg
 *   E2E_REAL_TURNSTILE_TESTING=true
 *   E2E_REAL_SELLER_EMAIL / E2E_REAL_SELLER_PASSWORD / E2E_REAL_SELLER_USERNAME
 *   E2E_REAL_BUYER_EMAIL / E2E_REAL_BUYER_PASSWORD / E2E_REAL_BUYER_USERNAME
 *
 * The full hosted deal lifecycle proof creates a unique listing per test and
 * therefore also requires:
 *   E2E_REAL_UPLOADS=true
 *   E2E_REAL_BRAND=<exact canonical brand name present in the staging catalogue>
 *
 * Required for the independent staff/MFA check:
 *   E2E_REAL_MODERATOR_EMAIL / E2E_REAL_MODERATOR_PASSWORD
 *   E2E_REAL_MODERATOR_TOTP_SECRET=<base32 secret for an already-enrolled factor>
 */

interface Credentials {
	email: string;
	password: string;
	username: string;
}

interface MarketplaceConfig {
	origin: string;
	seller: Credentials;
	buyer: Credentials;
	turnstileTesting: true;
	publication: { mode: 'uploads'; brand: string };
}

interface ModeratorConfig {
	origin: string;
	email: string;
	password: string;
	totpSecret: string;
	turnstileTesting: true;
}

const REQUIRED_REAL_FLAG = 'Set E2E_REAL_RUN=true to run the state-changing real-beta suite.';

function requiredEnvironment(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

function realOrigin(): string {
	const candidate = new URL(requiredEnvironment('E2E_REAL_BASE_URL'));
	const loopback = candidate.hostname === '127.0.0.1' || candidate.hostname === 'localhost';
	if (candidate.protocol !== 'https:' && !loopback) {
		throw new Error('E2E_REAL_BASE_URL must use HTTPS unless it targets localhost.');
	}
	if (candidate.username || candidate.password || candidate.search || candidate.hash) {
		throw new Error('E2E_REAL_BASE_URL must be a clean origin without credentials, query or hash.');
	}
	return candidate.origin;
}

function requireTestingTurnstile(): true {
	if (process.env.E2E_REAL_TURNSTILE_TESTING !== 'true') {
		throw new Error(
			'E2E_REAL_TURNSTILE_TESTING=true is required; configure the target with Cloudflare always-pass testing keys.'
		);
	}
	return true;
}

function credentials(prefix: 'SELLER' | 'BUYER'): Credentials {
	return {
		email: requiredEnvironment(`E2E_REAL_${prefix}_EMAIL`),
		password: requiredEnvironment(`E2E_REAL_${prefix}_PASSWORD`),
		username: requiredEnvironment(`E2E_REAL_${prefix}_USERNAME`)
	};
}

function marketplaceConfig(): MarketplaceConfig {
	const seller = credentials('SELLER');
	const buyer = credentials('BUYER');
	if (seller.email.toLocaleLowerCase('en') === buyer.email.toLocaleLowerCase('en')) {
		throw new Error('Seller and buyer must be different pre-provisioned users.');
	}

	if (process.env.E2E_REAL_UPLOADS !== 'true') {
		throw new Error(
			'E2E_REAL_UPLOADS=true is required for the full hosted deal lifecycle proof; each lifecycle test must publish a unique listing.'
		);
	}
	const publication: MarketplaceConfig['publication'] = {
		mode: 'uploads',
		brand: requiredEnvironment('E2E_REAL_BRAND')
	};

	return {
		origin: realOrigin(),
		seller,
		buyer,
		turnstileTesting: requireTestingTurnstile(),
		publication
	};
}

function moderatorConfig(): ModeratorConfig {
	return {
		origin: realOrigin(),
		email: requiredEnvironment('E2E_REAL_MODERATOR_EMAIL'),
		password: requiredEnvironment('E2E_REAL_MODERATOR_PASSWORD'),
		totpSecret: requiredEnvironment('E2E_REAL_MODERATOR_TOTP_SECRET'),
		turnstileTesting: requireTestingTurnstile()
	};
}

function onlyExplicitRealChromium(testInfo: TestInfo): void {
	test.skip(process.env.E2E_REAL_RUN !== 'true', REQUIRED_REAL_FLAG);
	test.skip(
		testInfo.project.name !== 'chromium',
		'Real-beta mutations run once in the desktop Chromium project.'
	);
}

function appUrl(origin: string, path: string): string {
	return new URL(path, `${origin}/`).toString();
}

async function gotoApp(page: Page, origin: string, path: string): Promise<void> {
	const response = await page.goto(appUrl(origin, path), { waitUntil: 'domcontentloaded' });
	if (!response?.ok()) {
		throw new Error(`GET ${path} returned ${response?.status() ?? 'no response'}.`);
	}
}

async function waitForTestingTurnstile(
	page: Page,
	hostSelector: string,
	context: string
): Promise<void> {
	const host = page.locator(hostSelector);
	await expect(host, `${context} must render a Turnstile widget`).toHaveCount(1, { timeout: 20_000 });
	const response = page.locator('input[name="cf-turnstile-response"]').last();
	await response.waitFor({ state: 'attached', timeout: 20_000 });
	await expect
		.poll(() => response.inputValue(), {
			message: `${context} Turnstile testing token was not issued`,
			timeout: 20_000
		})
		.toMatch(/\S/u);
}

async function login(
	page: Page,
	origin: string,
	account: Pick<Credentials, 'email' | 'password'>,
	next = '/dashboard'
): Promise<void> {
	await gotoApp(page, origin, `/login?next=${encodeURIComponent(next)}`);
	await expect(page.getByRole('heading', { name: 'Влез в профила си.' })).toBeVisible();
	await page.getByLabel('Имейл').fill(account.email);
	await page.getByLabel('Парола').fill(account.password);
	await waitForTestingTurnstile(page, '.cf-turnstile', 'Login');
	await page.getByRole('button', { name: 'Влез в профила' }).click();
	await page.waitForURL(
		(url) => url.origin === origin && new URL(url).pathname === next,
		{ timeout: 30_000 }
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const typeBytes = Buffer.from(type, 'ascii');
	const chunk = Buffer.alloc(12 + data.length);
	chunk.writeUInt32BE(data.length, 0);
	typeBytes.copy(chunk, 4);
	data.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
	return chunk;
}

function evidencePng(red: number, green: number, blue: number): Buffer {
	const width = 48;
	const height = 48;
	const scanlines = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * 3 + 1);
		scanlines[row] = 0;
		for (let x = 0; x < width; x += 1) {
			const pixel = row + 1 + x * 3;
			scanlines[pixel] = (red + x * 2) % 256;
			scanlines[pixel + 1] = (green + y * 2) % 256;
			scanlines[pixel + 2] = blue;
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', header),
		pngChunk('IDAT', deflateSync(scanlines)),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

async function publishListing(
	page: Page,
	config: MarketplaceConfig,
	runId: string
): Promise<{ slug: string; query: string }> {
	const fragrance = `BetaFlow${runId}`;
	await gotoApp(page, config.origin, '/publish');
	await expect(page.getByRole('heading', { name: 'Разкажи историята на аромата' })).toBeVisible();

	const brandInput = page.getByRole('combobox', { name: 'Марка' });
	await brandInput.fill(config.publication.brand);
	const brandOption = page
		.getByRole('option', {
			name: new RegExp(`^${escapeRegExp(config.publication.brand)}\\b`, 'iu')
		})
		.first();
	await expect(brandOption).toBeVisible();
	await brandOption.click();
	await page.getByLabel('Име на парфюма').fill(fragrance);
	await page.getByRole('button', { name: 'Продължи' }).click();

	await expect(page.getByRole('heading', { name: 'Каква обява създаваш?' })).toBeVisible();
	await page.locator('input[name="deal"][value="sale"]').check();
	await page.getByRole('button', { name: 'Продължи' }).click();

	await expect(page.getByRole('heading', { name: 'Опиши физическия продукт' })).toBeVisible();
	await page.locator('#bottle-volume').fill('50');
	await page.locator('#remaining-volume').fill('45');
	await page.getByRole('button', { name: 'Продължи' }).click();

	await expect(page.getByRole('heading', { name: 'Покажи реалния продукт' })).toBeVisible();
	const evidenceInputs = page.locator('.photo-grid input[type="file"]');
	await expect(evidenceInputs).toHaveCount(4);
	const colors: ReadonlyArray<readonly [number, number, number]> = [
		[116, 72, 45],
		[176, 128, 71],
		[61, 92, 118],
		[83, 128, 89]
	];
	for (const [index, color] of colors.entries()) {
		await evidenceInputs.nth(index).setInputFiles({
			name: `beta-evidence-${runId}-${index + 1}.png`,
			mimeType: 'image/png',
			buffer: evidencePng(...color)
		});
	}
	await expect(page.getByText('Всички нужни кадри са добавени.')).toBeVisible();
	await page.getByRole('button', { name: 'Продължи' }).click();

	await expect(page.getByRole('heading', { name: 'Добави цена и описание' })).toBeVisible();
	await page.getByLabel('Продажна цена').fill('42');
	await page.getByLabel('Град').fill('София');
	await page
		.getByLabel('Описание')
		.fill(`Автоматизирана beta обява ${runId}. Реален интеграционен тест с четири отделни доказателствени снимки.`);
	await waitForTestingTurnstile(page, '.turnstile-wrap', 'Listing upload');
	await page.getByRole('button', { name: 'Продължи' }).click();

	await expect(page.getByRole('heading', { name: 'Провери преди публикуване' })).toBeVisible({
		timeout: 120_000
	});
	await page.getByRole('button', { name: 'Публикувай обявата' }).click();
	await expect(page.getByRole('heading', { name: 'Обявата е активна' })).toBeVisible({
		timeout: 60_000
	});
	const href = await page.getByRole('link', { name: 'Виж обявата' }).getAttribute('href');
	if (!href?.startsWith('/listing/')) throw new Error('Published listing did not expose its canonical link.');
	return { slug: href.slice('/listing/'.length), query: fragrance };
}

async function findConversation(page: Page, query: string, counterpart: string): Promise<void> {
	const conversation = page.locator('.conversation-items > button').filter({ hasText: query }).first();
	await expect(conversation).toContainText(counterpart, { timeout: 30_000 });
	await conversation.click();
	await expect(page.locator('.chat-head')).toContainText(counterpart);
}

async function completeDeal(page: Page, origin: string, query: string): Promise<void> {
	await gotoApp(page, origin, '/deals');
	const deal = page.locator('article.deal-card').filter({ hasText: query }).first();
	await expect(deal).toBeVisible({ timeout: 30_000 });
	await deal.getByRole('button', { name: 'Отбележи като приключена' }).click();
	await expect(page.getByRole('status')).toHaveText('Действието е записано.');
}

async function cancelDeal(page: Page, origin: string, query: string, reason: string): Promise<void> {
	await gotoApp(page, origin, '/deals');
	const deal = page.locator('article.deal-card').filter({ hasText: query }).first();
	await expect(deal).toBeVisible({ timeout: 30_000 });
	await deal.getByText('Откажи сделката', { exact: true }).click();
	await deal.getByLabel('Причина').fill(reason);
	await deal.getByRole('button', { name: 'Потвърди отказа' }).click();
	await expect(page.getByRole('status')).toHaveText('Действието е записано.');
	await expect(deal).toContainText(reason);
	await expect(deal.getByRole('button', { name: 'Публикувай отзив' })).toHaveCount(0);
}

function decodeBase32(secret: string): Buffer {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const normalized = secret.toUpperCase().replace(/[\s=-]/gu, '');
	if (!normalized || [...normalized].some((character) => !alphabet.includes(character))) {
		throw new Error('E2E_REAL_MODERATOR_TOTP_SECRET is not valid base32.');
	}
	let bits = '';
	for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
	const bytes: number[] = [];
	for (let index = 0; index + 8 <= bits.length; index += 8) {
		bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
	}
	return Buffer.from(bytes);
}

function currentTotp(secret: string): string {
	const counter = BigInt(Math.floor(Date.now() / 30_000));
	const counterBytes = Buffer.alloc(8);
	counterBytes.writeBigUInt64BE(counter);
	const digest = createHmac('sha1', decodeBase32(secret)).update(counterBytes).digest();
	const offset = digest[digest.length - 1] & 0x0f;
	const binary =
		((digest[offset] & 0x7f) << 24) |
		((digest[offset + 1] & 0xff) << 16) |
		((digest[offset + 2] & 0xff) << 8) |
		(digest[offset + 3] & 0xff);
	return String(binary % 1_000_000).padStart(6, '0');
}

test.describe('real hosted marketplace', () => {
	test('seller → buyer → offer → chat → deal → review', async ({ browser }, testInfo) => {
		onlyExplicitRealChromium(testInfo);
		test.setTimeout(240_000);
		const config = marketplaceConfig();
		testInfo.annotations.push({
			type: 'environment',
			description: 'Unique real publication with Cloudflare Images, private Storage and four PNG evidence roles.'
		});

		const sellerContext = await browser.newContext();
		const buyerContext = await browser.newContext();
		const seller = await sellerContext.newPage();
		const buyer = await buyerContext.newPage();
		seller.setDefaultTimeout(30_000);
		buyer.setDefaultTimeout(30_000);
		const runId = `${Date.now().toString(36)}${testInfo.retry}`;

		try {
			await login(seller, config.origin, config.seller);
			const listing = await publishListing(seller, config, runId);

			await login(buyer, config.origin, config.buyer);
			await gotoApp(buyer, config.origin, '/listings');
			await buyer.getByRole('textbox', { name: 'Търси аромат или марка' }).fill(listing.query);
			await buyer.getByRole('button', { name: 'Търси' }).click();
			await buyer.waitForURL((url) => url.pathname === '/listings' && url.searchParams.get('q') === listing.query);
			const listingCard = buyer.locator('article.listing-card').filter({ hasText: listing.query }).first();
			await expect(listingCard).toBeVisible({ timeout: 30_000 });
			await listingCard.getByRole('link', { name: 'Виж обявата' }).click();
			await expect(buyer).toHaveURL(new RegExp(`/listing/${escapeRegExp(listing.slug)}$`, 'u'));
			await expect(buyer.getByRole('link', { name: config.seller.username, exact: true })).toBeVisible();

			const offerNote = `E2E offer ${runId}`;
			await buyer.getByRole('button', { name: 'Изпрати оферта' }).click();
			const offerDialog = buyer.getByRole('dialog', { name: 'Твоята оферта' });
			await offerDialog.getByLabel('Предложена сума').fill('40');
			await offerDialog.getByLabel('Кратка бележка (по избор)').fill(offerNote);
			await waitForTestingTurnstile(buyer, '.cf-turnstile', 'Offer');
			await offerDialog.getByRole('button', { name: 'Изпрати намерение' }).click();
			await expect(offerDialog.getByRole('heading', { name: 'Офертата е изпратена.' })).toBeVisible();

			await gotoApp(seller, config.origin, '/offers?direction=received');
			const receivedOffer = seller.locator('article.offer-card').filter({ hasText: offerNote }).first();
			await expect(receivedOffer).toContainText(config.buyer.username, { timeout: 30_000 });
			await receivedOffer.getByRole('button', { name: 'Приеми и резервирай' }).click();
			await seller.waitForURL((url) => url.pathname === '/deals' && Boolean(url.searchParams.get('highlight')));

			const sellerMessage = `Потвърждавам тестовата оферта ${runId}.`;
			await gotoApp(seller, config.origin, '/messages');
			await findConversation(seller, listing.query, config.buyer.username);
			await seller.getByRole('textbox', { name: 'Съобщение' }).fill(sellerMessage);
			await seller.getByRole('button', { name: 'Изпрати' }).click();
			await expect(seller.getByText(sellerMessage, { exact: true })).toBeVisible();

			const buyerMessage = `Получено, приключваме beta сделката ${runId}.`;
			await gotoApp(buyer, config.origin, '/messages');
			await findConversation(buyer, listing.query, config.seller.username);
			await expect(buyer.getByText(sellerMessage, { exact: true })).toBeVisible({ timeout: 30_000 });
			await buyer.getByRole('textbox', { name: 'Съобщение' }).fill(buyerMessage);
			await buyer.getByRole('button', { name: 'Изпрати' }).click();
			await expect(buyer.getByText(buyerMessage, { exact: true })).toBeVisible();

			await gotoApp(buyer, config.origin, '/deals');
			const buyerDeal = buyer.locator('article.deal-card').filter({ hasText: listing.query }).first();
			await expect(buyerDeal.getByRole('button', { name: 'Отбележи като приключена' })).toHaveCount(0);
			await expect(buyerDeal).toContainText('Продавачът отбелязва сделката като приключена.');
			await completeDeal(seller, config.origin, listing.query);

			await gotoApp(buyer, config.origin, '/deals');
			const completedDeal = buyer.locator('article.deal-card').filter({ hasText: listing.query }).first();
			await expect(completedDeal).toContainText('Приключена', { timeout: 30_000 });
			await completedDeal.getByLabel('Оценка').selectOption('5');
			await completedDeal.getByLabel('Отзив').fill(`Коректна beta сделка ${runId}.`);
			await completedDeal.getByRole('button', { name: 'Публикувай отзив' }).click();
			await expect(buyer.getByRole('status')).toHaveText('Действието е записано.');
		} finally {
			await Promise.all([sellerContext.close(), buyerContext.close()]);
		}
	});

	for (const cancellingRole of ['seller', 'buyer'] as const) {
		test(`${cancellingRole} cancels an accepted deal with a stored reason and no review`, async ({ browser }, testInfo) => {
			onlyExplicitRealChromium(testInfo);
			test.setTimeout(240_000);
			const config = marketplaceConfig();
			const sellerContext = await browser.newContext();
			const buyerContext = await browser.newContext();
			const seller = await sellerContext.newPage();
			const buyer = await buyerContext.newPage();
			seller.setDefaultTimeout(30_000);
			buyer.setDefaultTimeout(30_000);
			const runId = `${Date.now().toString(36)}-${cancellingRole}-${testInfo.retry}`;

			try {
				await login(seller, config.origin, config.seller);
				const listing = await publishListing(seller, config, runId);
				await login(buyer, config.origin, config.buyer);
				await gotoApp(buyer, config.origin, `/listing/${listing.slug}`);
				const offerNote = `Cancellation offer ${runId}`;
				await buyer.getByRole('button', { name: 'Изпрати оферта' }).click();
				const offerDialog = buyer.getByRole('dialog', { name: 'Твоята оферта' });
				await offerDialog.getByLabel('Предложена сума').fill('40');
				await offerDialog.getByLabel('Кратка бележка (по избор)').fill(offerNote);
				await waitForTestingTurnstile(buyer, '.cf-turnstile', 'Offer');
				await offerDialog.getByRole('button', { name: 'Изпрати намерение' }).click();
				await expect(offerDialog.getByRole('heading', { name: 'Офертата е изпратена.' })).toBeVisible();
				await gotoApp(seller, config.origin, '/offers?direction=received');
				const receivedOffer = seller.locator('article.offer-card').filter({ hasText: offerNote }).first();
				await receivedOffer.getByRole('button', { name: 'Приеми и резервирай' }).click();
				await seller.waitForURL((url) => url.pathname === '/deals' && Boolean(url.searchParams.get('highlight')));

				const reason = `Cancellation reason ${runId}`;
				await cancelDeal(cancellingRole === 'seller' ? seller : buyer, config.origin, listing.query, reason);
				await gotoApp(cancellingRole === 'seller' ? buyer : seller, config.origin, '/deals');
				const counterpartDeal = (cancellingRole === 'seller' ? buyer : seller)
					.locator('article.deal-card')
					.filter({ hasText: listing.query })
					.first();
				await expect(counterpartDeal).toContainText(reason);
				await expect(counterpartDeal.getByRole('button', { name: 'Публикувай отзив' })).toHaveCount(0);
			} finally {
				await Promise.all([sellerContext.close(), buyerContext.close()]);
			}
		});
	}

	test('moderator reaches the AAL2 moderation queue', async ({ browser }, testInfo) => {
		onlyExplicitRealChromium(testInfo);
		test.setTimeout(90_000);
		const config = moderatorConfig();
		const context = await browser.newContext();
		const page = await context.newPage();
		page.setDefaultTimeout(30_000);

		try {
			await gotoApp(page, config.origin, '/login?next=%2Fadmin');
			await page.getByLabel('Имейл').fill(config.email);
			await page.getByLabel('Парола').fill(config.password);
			await waitForTestingTurnstile(page, '.cf-turnstile', 'Moderator login');
			await page.getByRole('button', { name: 'Влез в профила' }).click();
			await page.waitForURL(
				(url) => url.origin === config.origin && ['/admin', '/auth/mfa'].includes(url.pathname),
				{ timeout: 30_000 }
			);

			if (new URL(page.url()).pathname === '/auth/mfa') {
				await expect(page.getByRole('heading', { name: 'Потвърди втория фактор.' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Настрой MFA' })).toHaveCount(0);
				const millisecondsLeft = 30_000 - (Date.now() % 30_000);
				if (millisecondsLeft < 4_000) await page.waitForTimeout(millisecondsLeft + 250);
				await page.locator('#mfa-code').fill(currentTotp(config.totpSecret));
				await page.getByRole('button', { name: 'Продължи' }).click();
				await page.waitForURL((url) => url.origin === config.origin && url.pathname === '/admin', {
					timeout: 30_000
				});
			}

			await expect(page.getByRole('heading', { name: 'Модерационен център' })).toBeVisible();
			await expect(page.getByText('Защитена сесия · AAL2', { exact: true })).toBeVisible();
			await expect(page.getByRole('region', { name: 'Състояние на опашката' })).toBeVisible();
		} finally {
			await context.close();
		}
	});
});
