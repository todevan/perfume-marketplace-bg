import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { deflateSync } from 'node:zlib';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createEncryptedModeratorCredentialStore } from '../../scripts/hosted-a9-credential-store.mjs';
import {
	expect,
	test,
	type APIResponse,
	type BrowserContext,
	type Page,
	type TestInfo
} from '@playwright/test';
import {
	HOSTED_STAGING,
	assertSanitizedHostedErrorBody,
	cleanupHostedManifestFile,
	createHostedEvidenceOperator,
	createHostedRunManifest,
	createSanitizedOperatorRecord,
	createSupabaseHostedEvidenceAdapters,
	generateTotpCode,
	isHostedA10ScenarioApproved,
	loadHostedRunManifest,
	persistHostedRunManifest,
	registerHostedQueueRow,
	registerHostedReport,
	registerHostedUpload,
	registerIssue24Checkpoint,
	validateHostedA10Environment,
	validateHostedCleanupEnvironment,
	validateIssue24HostedEnvironment
} from '../../scripts/hosted-report-evidence-operator.mjs';

const REQUIRED_ENVIRONMENT = [
	'APP_ENV',
	'E2E_REAL_BASE_URL',
	'E2E_REAL_TURNSTILE_TESTING',
	'E2E_REAL_REPORT_EVIDENCE_RUN_ID',
	'E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH',
	'E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH',
	'E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY',
	'E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE',
	'E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER',
	'PUBLIC_SUPABASE_URL',
	'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
	'EXPECTED_SUPABASE_PROJECT_REF',
	'SUPABASE_SECRET_KEY',
	'SUPABASE_ACCESS_TOKEN',
	'UPLOAD_CLEANUP_SECRET',
	'RELEASE_COMMIT_SHA',
	'E2E_REAL_REPORTER_EMAIL',
	'E2E_REAL_REPORTER_PASSWORD',
	'E2E_REAL_REPORTER_USERNAME',
	'E2E_REAL_CROSS_USER_EMAIL',
	'E2E_REAL_CROSS_USER_PASSWORD',
	'E2E_REAL_CROSS_USER_USERNAME',
	'E2E_REAL_ASSIGNED_MODERATOR_EMAIL',
	'E2E_REAL_ASSIGNED_MODERATOR_PASSWORD',
	'E2E_REAL_ASSIGNED_MODERATOR_USERNAME',
	'E2E_REAL_UNASSIGNED_MODERATOR_EMAIL',
	'E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD',
	'E2E_REAL_UNASSIGNED_MODERATOR_USERNAME'
] as const;
const HOSTED_RUN_ENABLED =
	process.env.E2E_REAL_RUN === 'true' &&
	process.env.E2E_REAL_REPORT_EVIDENCE_RUN === 'true' &&
	REQUIRED_ENVIRONMENT.every((name) => Boolean(process.env[name]?.trim()));
const HOSTED_CLEANUP_ENABLED =
	HOSTED_RUN_ENABLED &&
	process.env.E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN === 'true' &&
	process.env.E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL === 'A11';
const HOSTED_SCENARIO_ENABLED =
	HOSTED_RUN_ENABLED && !process.env.E2E_REAL_ISSUE_24_RUN && isHostedA10ScenarioApproved(process.env);
const ISSUE_24_REQUIRED_ENVIRONMENT = [
	...REQUIRED_ENVIRONMENT,
	'E2E_REAL_ISSUE_24_ORGANIZATION_ID',
	'E2E_REAL_ISSUE_24_REGION',
	'E2E_REAL_ISSUE_24_WORKER_NAME',
	'E2E_REAL_ISSUE_24_CANDIDATE_SHA',
	'E2E_REAL_ISSUE_24_CONVERSATION_ID',
	'E2E_REAL_AAL1_STAFF_EMAIL',
	'E2E_REAL_AAL1_STAFF_PASSWORD',
	'E2E_REAL_AAL1_STAFF_USERNAME',
	'E2E_REAL_UNASSIGNED_ADMIN_EMAIL',
	'E2E_REAL_UNASSIGNED_ADMIN_PASSWORD',
	'E2E_REAL_UNASSIGNED_ADMIN_USERNAME'
] as const;
const ISSUE_24_SCENARIO_ENABLED =
	process.env.E2E_REAL_ISSUE_24_RUN === 'true' &&
	process.env.E2E_REAL_ISSUE_24_APPROVAL === 'ISSUE-24' &&
	isHostedA10ScenarioApproved(process.env) &&
	ISSUE_24_REQUIRED_ENVIRONMENT.every((name) => Boolean(process.env[name]?.trim()));
const HOSTED_SKIP_REASON =
	'Hosted report-evidence verification requires both explicit real-run flags and every approved secure input.';
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_REQUEST_BYTES = 4 * MAX_EVIDENCE_BYTES + 512 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface ActorCredentials {
	email: string;
	password: string;
	username: string;
}

interface HostedConfiguration {
	target: {
		projectRef: string;
		organizationId: string;
		region: string;
		supabaseUrl: string;
		workerOrigin: string;
		workerName?: string;
	};
	runId: string;
	actorRoles: Record<string, ActorCredentials>;
	serviceKey: string;
	provisioningNonce: string;
	provisionedAfter: string;
	candidateSha?: string;
}

interface ScopedCounts {
	accounts: number;
	reports: number;
	uploads: number;
	objects: number;
	queueRows: number;
	foreignArtifacts: number;
	preExistingAccounts: number;
}

interface EvidenceUpload {
	id: string;
	uploader_id: string;
	storage_path: string;
	status: 'pending' | 'finalized' | 'attached' | 'rejected' | 'expired';
	source_byte_size: number;
	actual_content_hash: string | null;
	actual_byte_size: number | null;
	actual_mime_type: string | null;
	width_px: number | null;
	height_px: number | null;
	report_id: string | null;
	created_at: string;
	finalized_at: string | null;
	attached_at: string | null;
}

interface ReportRow {
	id: string;
	reporter_id: string;
	target_id: string;
	details: string | null;
	evidence_paths: string[];
	status: string;
	assigned_to: string | null;
}

interface ObjectInspection {
	exists: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	byteSize: number | null;
	mimeType: string | null;
}

interface WorkerReceipt {
	status: number;
	requestId: string;
}

interface StorageReceipt {
	status: number;
	bytes: Buffer | null;
}

type RunManifest = ReturnType<typeof createHostedRunManifest>;
type HostedOperator = ReturnType<typeof createHostedEvidenceOperator>;

function requiredEnvironment(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error('Hosted report-evidence environment is incomplete.');
	return value;
}

function sameCounts(left: ScopedCounts, right: ScopedCounts): boolean {
	return Object.keys(left).every(
		(key) => left[key as keyof ScopedCounts] === right[key as keyof ScopedCounts]
	);
}

async function persistManifest(
	configuration: HostedConfiguration,
	manifest: RunManifest
): Promise<void> {
	await persistHostedRunManifest(
		configuration,
		manifest,
		requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH')
	);
}

async function persistIssue24Checkpoint(
	configuration: HostedConfiguration,
	manifest: RunManifest,
	stage:
		| 'deployment-attested'
		| 'actors-attested'
		| 'reporter-safety'
		| 'block-enforced'
		| 'privacy-denials'
		| 'queue-privacy'
		| 'claim-race'
		| 'decision-committed'
		| 'reporter-outcome'
		| 'mutation-denials'
): Promise<RunManifest> {
	if (!configuration.candidateSha) throw new Error('Issue #24 candidate binding is missing.');
	const next = registerIssue24Checkpoint(
		manifest,
		stage,
		configuration.candidateSha,
		new Date().toISOString()
	);
	await persistManifest(configuration, next);
	return next;
}

function recordScenario(
	testInfo: TestInfo,
	input: {
		scenario: number;
		runId: string;
		actorRole: string;
		boundary: 'HTTP' | 'Storage' | 'database' | 'operator';
		actualResult:
			| 'HTTP 200'
			| 'HTTP 400'
			| 'HTTP 413'
			| 'Storage 200 bytes'
			| 'Storage denied non-2xx'
			| 'database transition verified';
		requestId: string;
		before: ScopedCounts;
		after: ScopedCounts;
		cleanup: 'none' | 'pending-A11';
	}
): void {
	const record = createSanitizedOperatorRecord({
		event: `hosted_scenario_${input.scenario}`,
		runId: input.runId,
		actorRole: input.actorRole,
		status: 'PASS',
		boundary: input.boundary,
		actualResult: input.actualResult,
		requestId: input.requestId,
		before: input.before,
		after: input.after,
		cleanup: input.cleanup
	});
	testInfo.annotations.push({ type: 'gate3-evidence', description: JSON.stringify(record) });
}

function recordCleanupRequired(
	testInfo: TestInfo,
	runId: string,
	counts: ScopedCounts
): void {
	const record = createSanitizedOperatorRecord({
		event: 'cleanup_required',
		runId,
		actorRole: 'operator',
		status: 'BLOCKED',
		boundary: 'operator',
		actualResult: 'cleanup required',
		requestId: 'not-exposed',
		before: counts,
		after: counts,
		cleanup: 'pending-A11'
	});
	testInfo.annotations.push({ type: 'gate3-cleanup', description: JSON.stringify(record) });
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

function syntheticPng(): Buffer {
	const width = 48;
	const height = 48;
	const scanlines = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * 3 + 1);
		for (let x = 0; x < width; x += 1) {
			const pixel = row + 1 + x * 3;
			scanlines[pixel] = (x * 7) % 256;
			scanlines[pixel + 1] = (y * 11) % 256;
			scanlines[pixel + 2] = 173;
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

function syntheticWebp(): Buffer {
	return Buffer.from(
		'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA',
		'base64'
	);
}

async function waitForTestingTurnstile(page: Page): Promise<string> {
	const response = page.locator('input[name="cf-turnstile-response"]').last();
	await response.waitFor({ state: 'attached', timeout: 20_000 });
	await expect.poll(() => response.inputValue(), { timeout: 20_000 }).toMatch(/\S/u);
	const token = await response.inputValue();
	if (!token) throw new Error('Turnstile testing token is missing.');
	return token;
}

async function freshReportToken(page: Page, targetId: string): Promise<string> {
	await page.goto(`/report?targetType=profile&targetId=${encodeURIComponent(targetId)}`, {
		waitUntil: 'domcontentloaded'
	});
	return waitForTestingTurnstile(page);
}

async function loginForApp(page: Page, actor: ActorCredentials, next: string): Promise<void> {
	await page.goto(`/login?next=${encodeURIComponent(next)}`, { waitUntil: 'domcontentloaded' });
	await waitForTestingTurnstile(page);
	await page.locator('#email').fill(actor.email);
	await page.locator('#password').fill(actor.password);
	await page.locator('button[type="submit"]').click();
}

function workerReceiptFromHeaders(status: number, headers: Record<string, string>): WorkerReceipt {
	const requestId = headers['x-request-id'] ?? '';
	if (
		headers['x-deployed-git-sha'] !== requiredEnvironment('RELEASE_COMMIT_SHA') ||
		!UUID_PATTERN.test(requestId)
	) {
		throw new Error('Response is not attested to the exact staging Worker candidate.');
	}
	return { status, requestId };
}

function workerReceipt(response: APIResponse): WorkerReceipt {
	return workerReceiptFromHeaders(response.status(), response.headers());
}

function actorClient(
	publishableKey: string,
	supabaseUrl: string = HOSTED_STAGING.supabaseUrl
): SupabaseClient {
	return createClient(supabaseUrl, publishableKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

async function signInActor(client: SupabaseClient, actor: ActorCredentials): Promise<string> {
	const { data, error } = await client.auth.signInWithPassword({
		email: actor.email,
		password: actor.password
	});
	if (error || !data.user) throw new Error('Synthetic actor sign-in failed.');
	return data.user.id;
}

type ModeratorRole = 'assigned-moderator' | 'unassigned-moderator' | 'unassigned-admin';
type ModeratorCredentialStore = ReturnType<typeof createEncryptedModeratorCredentialStore>;

async function moderatorTotpCode(
	credentialStore: ModeratorCredentialStore,
	role: ModeratorRole
): Promise<string> {
	const secret = await credentialStore.getModeratorTotpSecret({ role });
	return generateTotpCode(secret, Date.now());
}

async function elevateToAal2(
	client: SupabaseClient,
	role: ModeratorRole,
	credentialStore: ModeratorCredentialStore
): Promise<void> {
	const { data: factors, error: factorError } = await client.auth.mfa.listFactors();
	const factor = factors?.totp.find((entry) => entry.status === 'verified');
	if (factorError || !factor) throw new Error('Synthetic moderator has no verified TOTP factor.');
	const { error } = await client.auth.mfa.challengeAndVerify({
		factorId: factor.id,
		code: await moderatorTotpCode(credentialStore, role)
	});
	if (error) throw new Error('Synthetic moderator AAL2 verification failed.');
	const { data: assurance } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
	if (assurance?.currentLevel !== 'aal2') throw new Error('Synthetic moderator is not at AAL2.');
}

async function storageDownload(client: SupabaseClient, path: string): Promise<StorageReceipt> {
	const { data, error } = await client.storage.from('report-evidence').download(path);
	if (error || !data) {
		const candidate = Number((error as { statusCode?: number | string } | null)?.statusCode ?? 0);
		return { status: Number.isInteger(candidate) ? candidate : 0, bytes: null };
	}
	return { status: 200, bytes: Buffer.from(await data.arrayBuffer()) };
}

async function submitEvidenceReport(
	page: Page,
	targetId: string,
	runId: string,
	file: Buffer
): Promise<{ reportId: string; receipt: WorkerReceipt }> {
	await page.goto(`/report?targetType=profile&targetId=${encodeURIComponent(targetId)}`, {
		waitUntil: 'domcontentloaded'
	});
	await page.locator('select[name="reasonCode"]').selectOption('harassment');
	await page.locator('textarea[name="details"]').fill(`Synthetic Gate 3 evidence ${runId}`);
	await page.locator('input[name="evidence"]').setInputFiles({
		name: 'synthetic-evidence.png',
		mimeType: 'image/png',
		buffer: file
	});
	await page.locator('input[type="checkbox"]').check();
	await waitForTestingTurnstile(page);
	const responsePromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/report'
	);
	await page.getByRole('button', { name: 'Изпрати сигнала' }).click();
	const response = await responsePromise;
	const receipt = workerReceiptFromHeaders(response.status(), await response.allHeaders());
	if (receipt.status >= 400) throw new Error('Synthetic report submission failed.');
	await expect(page.getByRole('status')).toBeVisible();
	const reportId = (await page.getByRole('status').locator('code').textContent())?.trim() ?? '';
	if (!UUID_PATTERN.test(reportId)) throw new Error('Synthetic report receipt is invalid.');
	return { reportId, receipt };
}

type MultipartPart =
	| { name: string; value: string }
	| { name: string; filename: string; mimeType: string; bytes: Buffer };

function multipartBody(boundary: string, parts: readonly MultipartPart[], close = true): Buffer {
	const chunks: Buffer[] = [];
	for (const part of parts) {
		chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
		if ('value' in part) {
			chunks.push(
				Buffer.from(
					`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
					'utf8'
				)
			);
		} else {
			chunks.push(
				Buffer.from(
					`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.mimeType}\r\n\r\n`,
					'utf8'
				),
				part.bytes,
				Buffer.from('\r\n', 'utf8')
			);
		}
	}
	if (close) chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
	return Buffer.concat(chunks);
}

function reportParts(
	targetId: string,
	runId: string,
	turnstileToken: string,
	files: readonly Buffer[],
	extraDetails = ''
): MultipartPart[] {
	return [
		{ name: 'targetType', value: 'profile' },
		{ name: 'targetId', value: targetId },
		{ name: 'reasonCode', value: 'harassment' },
		{ name: 'details', value: `Synthetic hostile upload ${runId}${extraDetails}` },
		{ name: 'cf-turnstile-response', value: turnstileToken },
		...files.map((bytes, index) => ({
			name: 'evidence',
			filename: `hostile-${index}.png`,
			mimeType: 'image/png',
			bytes
		}))
	];
}

async function rawReportRequest(
	context: BrowserContext,
	body: Buffer,
	boundary: string,
	mode: 'chunked' | 'understated'
): Promise<WorkerReceipt> {
	const cookieHeader = (await context.cookies())
		.map((cookie) => `${cookie.name}=${cookie.value}`)
		.join('; ');
	return await new Promise<WorkerReceipt>((resolve, reject) => {
		const request = httpsRequest(
			new URL('/report', HOSTED_STAGING.workerOrigin),
			{
				method: 'POST',
				headers: {
					'content-type': `multipart/form-data; boundary=${boundary}`,
					cookie: cookieHeader,
					...(mode === 'chunked'
						? { 'transfer-encoding': 'chunked' }
						: { 'content-length': String(Math.min(1024, body.byteLength - 1)) })
				}
			},
			(response) => {
				response.resume();
				response.on('end', () => {
					const headers = Object.fromEntries(
						Object.entries(response.headers).map(([name, value]) => [
							name,
							Array.isArray(value) ? value.join(',') : String(value ?? '')
						])
					);
					try {
						resolve(workerReceiptFromHeaders(response.statusCode ?? 0, headers));
					} catch (error) {
						reject(error);
					}
				});
			}
		);
		request.on('error', () => reject(new Error('Hostile stream request failed before a response.')));
		for (let offset = 0; offset < body.byteLength; offset += 64 * 1024) {
			request.write(body.subarray(offset, Math.min(offset + 64 * 1024, body.byteLength)));
		}
		request.end();
	});
}

async function postMultipart(
	page: Page,
	body: Buffer,
	boundary: string,
	expectedError?: string,
	forbiddenValues: readonly string[] = []
): Promise<WorkerReceipt> {
	const response = await page.request.post('/report', {
		data: body,
		headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
	});
	if (expectedError) {
		assertSanitizedHostedErrorBody(
			(await response.body()).toString('utf8'),
			expectedError,
			forbiddenValues
		);
	}
	return workerReceipt(response);
}

test.describe('hosted report-evidence security matrix', () => {
	test('executes all ten target-locked scenarios', async ({ browser }, testInfo) => {
		test.skip(testInfo.project.name !== 'chromium', 'Hosted mutations run once in the desktop project.');
		test.skip(!HOSTED_SCENARIO_ENABLED, HOSTED_SKIP_REASON);
		test.setTimeout(12 * 60_000);
		if (requiredEnvironment('E2E_REAL_TURNSTILE_TESTING') !== 'true') {
			throw new Error('Hosted fixtures are not approved fresh testing actors.');
		}

		const configuration = validateHostedA10Environment(process.env) as HostedConfiguration;
		const publishableKey = requiredEnvironment('PUBLIC_SUPABASE_PUBLISHABLE_KEY');
		const credentialStore = createEncryptedModeratorCredentialStore({
			filePath: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH'),
			encryptionKey: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY'),
			projectRef: configuration.target.projectRef,
			runId: configuration.runId
		});
		const adapters = createSupabaseHostedEvidenceAdapters({
			config: configuration,
			serviceClient: createClient(configuration.target.supabaseUrl, configuration.serviceKey, {
				auth: { autoRefreshToken: false, persistSession: false }
			}),
			managementAccessToken: requiredEnvironment('SUPABASE_ACCESS_TOKEN'),
			cleanupSecret: requiredEnvironment('UPLOAD_CLEANUP_SECRET')
		});
		const operator = createHostedEvidenceOperator({ config: configuration, adapters });
		const reporterClient = actorClient(publishableKey);
		const crossUserClient = actorClient(publishableKey);
		const assignedModeratorClient = actorClient(publishableKey);
		const unassignedModeratorClient = actorClient(publishableKey);
		const reporter = configuration.actorRoles.reporter;
		const crossUser = configuration.actorRoles['cross-user'];
		const assignedModerator = configuration.actorRoles['assigned-moderator'];
		const unassignedModerator = configuration.actorRoles['unassigned-moderator'];
		const [reporterId, crossUserId, assignedModeratorId, unassignedModeratorId] =
			await Promise.all([
				signInActor(reporterClient, reporter),
				signInActor(crossUserClient, crossUser),
				signInActor(assignedModeratorClient, assignedModerator),
				signInActor(unassignedModeratorClient, unassignedModerator)
			]);
		if (new Set([reporterId, crossUserId, assignedModeratorId, unassignedModeratorId]).size !== 4) {
			throw new Error('Hosted synthetic actors are not distinct.');
		}
		let manifest: RunManifest = await loadHostedRunManifest(
			configuration,
			requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH')
		);
		const [reporterReceipt, crossUserReceipt, assignedReceipt, unassignedReceipt] =
			await Promise.all([
				operator.attestFreshActor(manifest, 'reporter', reporterId),
				operator.attestFreshActor(manifest, 'cross-user', crossUserId),
				operator.attestFreshActor(manifest, 'assigned-moderator', assignedModeratorId),
				operator.attestFreshActor(manifest, 'unassigned-moderator', unassignedModeratorId)
			]);

		const attestedActors = [reporterReceipt, crossUserReceipt, assignedReceipt, unassignedReceipt];
		if (
			manifest.credentialStoreId !== credentialStore.credentialStoreId ||
			manifest.pendingActors.length !== 0 ||
			manifest.actors.length !== 4 ||
			attestedActors.some(
				(receipt) =>
					!manifest.actors.some(
						(actor) => actor.role === receipt.role && actor.userId === receipt.userId
					)
			)
		) {
			throw new Error('Hosted A9 manifest does not match the attested actors and credential store.');
		}
		let lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
		if (
			lastMeasured.accounts !== 4 ||
			lastMeasured.reports !== 0 ||
			lastMeasured.uploads !== 0 ||
			lastMeasured.objects !== 0 ||
			lastMeasured.queueRows !== 0
		) {
			throw new Error('Hosted fixture accounts are not empty and isolated.');
		}

		const reporterContext = await browser.newContext();
		const moderatorContext = await browser.newContext();
		const reporterPage = await reporterContext.newPage();
		const moderatorPage = await moderatorContext.newPage();
		let reportId = '';
		let uploadId = '';
		let upload: EvidenceUpload | null = null;

		try {
			await loginForApp(reporterPage, reporter, '/dashboard');
			await reporterPage.waitForURL((url) => url.pathname === '/dashboard', { timeout: 30_000 });

			await test.step('2. reporter creates one sanitized evidence report', async () => {
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const submission = await submitEvidenceReport(
					reporterPage,
					crossUserId,
					configuration.runId,
					syntheticPng()
				);
				reportId = submission.reportId;
				manifest = registerHostedReport(manifest, reportId, 'reporter');
				await persistManifest(configuration, manifest);
				const discovered = (await operator.discoverUploadForReport(manifest, reportId)) as {
					id: string;
					uploader_id: string;
					storage_path: string;
				};
				manifest = registerHostedUpload(
					manifest,
					discovered.id,
					'reporter',
					discovered.storage_path
				);
				await persistManifest(configuration, manifest);
				uploadId = discovered.id;
				upload = (await operator.inspectUpload(manifest, uploadId)) as unknown as EvidenceUpload;
				const report = (await operator.inspectReport(manifest, reportId)) as unknown as ReportRow;
				const object = (await operator.inspectObject(manifest, uploadId)) as unknown as ObjectInspection;
				expect(
					report.reporter_id === reporterId &&
						report.target_id === crossUserId &&
						report.evidence_paths.length === 1 &&
						report.evidence_paths[0] === upload.storage_path &&
						upload.uploader_id === reporterId &&
						upload.status === 'attached' &&
						upload.report_id === reportId &&
						object.exists
				).toBe(true);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 2,
					runId: configuration.runId,
					actorRole: 'reporter',
					boundary: 'HTTP',
					actualResult: 'HTTP 200',
					requestId: submission.receipt.requestId,
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('3. object existence and metadata precede the attached transition', async () => {
				if (!upload) throw new Error('Evidence finalization precondition is missing.');
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const object = (await operator.inspectObject(manifest, uploadId)) as unknown as ObjectInspection;
				const reporterRead = await storageDownload(reporterClient, upload.storage_path);
				const metadataIsComplete =
					object.exists &&
					Boolean(object.createdAt) &&
					Boolean(upload.finalized_at) &&
					Boolean(upload.attached_at) &&
					Date.parse(object.createdAt ?? '') <= Date.parse(upload.finalized_at ?? '') &&
					Date.parse(upload.finalized_at ?? '') <= Date.parse(upload.attached_at ?? '') &&
					upload.actual_mime_type === 'image/webp' &&
					Boolean(upload.actual_content_hash?.match(/^[a-f0-9]{64}$/u)) &&
					upload.actual_byte_size === object.byteSize &&
					upload.actual_byte_size === reporterRead.bytes?.byteLength &&
					Number(upload.width_px) >= 1 &&
					Number(upload.width_px) <= 10_000 &&
					Number(upload.height_px) >= 1 &&
					Number(upload.height_px) <= 10_000;
				expect(metadataIsComplete).toBe(true);
				expect(
					reporterRead.bytes
						? createHash('sha256').update(reporterRead.bytes).digest('hex') === upload.actual_content_hash
						: false
				).toBe(true);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 3,
					runId: configuration.runId,
					actorRole: 'operator',
					boundary: 'database',
					actualResult: 'database transition verified',
					requestId: 'not-exposed',
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('1. ordinary cross-user receives a real Storage denial', async () => {
				if (!upload?.actual_content_hash || !upload.actual_byte_size) {
					throw new Error('Evidence access precondition is missing.');
				}
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const reporterRead = await storageDownload(reporterClient, upload.storage_path);
				const crossUserRead = await storageDownload(crossUserClient, upload.storage_path);
				expect(
					reporterRead.status === 200 &&
						reporterRead.bytes?.byteLength === upload.actual_byte_size &&
						createHash('sha256').update(reporterRead.bytes).digest('hex') === upload.actual_content_hash
				).toBe(true);
				expect(crossUserRead.status >= 400 && crossUserRead.bytes === null).toBe(true);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 1,
					runId: configuration.runId,
					actorRole: 'cross-user',
					boundary: 'Storage',
					actualResult: 'Storage denied non-2xx',
					requestId: 'not-exposed',
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('4. attached evidence cannot be reused or rejected by reconciliation', async () => {
				if (!upload) throw new Error('One-time attachment precondition is missing.');
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const duplicate = await reporterClient.from('reports').insert({
					reporter_id: reporterId,
					target_type: 'profile',
					target_id: crossUserId,
					reason_code: 'harassment',
					details: `Synthetic duplicate check ${configuration.runId}`,
					evidence_paths: [upload.storage_path],
					status: 'open'
				});
				expect(Boolean(duplicate.error)).toBe(true);
				const disposable = await reporterClient.rpc('create_report_evidence_upload', {
					source_mime_type: 'image/png',
					source_byte_size: syntheticPng().byteLength
				});
				const row = Array.isArray(disposable.data) ? disposable.data[0] : disposable.data;
				if (disposable.error || !row?.upload_id || !row.storage_path) {
					throw new Error('Disposable reconciliation fixture could not be allocated.');
				}
				manifest = registerHostedUpload(manifest, row.upload_id, 'reporter', row.storage_path);
				await persistManifest(configuration, manifest);
				const reconciled = await operator.reconcileExactUploads(
					manifest,
					[upload.id, row.upload_id],
					'hosted_reconciliation_check'
				);
				expect(reconciled.length === 1 && reconciled[0] === row.upload_id).toBe(true);
				const queue = (await operator.discoverQueueForUpload(manifest, row.upload_id)) as {
					id: number;
				};
				manifest = registerHostedQueueRow(manifest, queue.id, row.upload_id);
				await persistManifest(configuration, manifest);
				const attachedAfter = (await operator.inspectUpload(manifest, upload.id)) as unknown as EvidenceUpload;
				expect(attachedAfter.status === 'attached' && attachedAfter.id === upload.id).toBe(true);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 4,
					runId: configuration.runId,
					actorRole: 'reporter',
					boundary: 'database',
					actualResult: 'database transition verified',
					requestId: 'not-exposed',
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('7. assigned moderator is denied at AAL1 and challenged by the admin route', async () => {
				if (!upload) throw new Error('Moderator AAL1 precondition is missing.');
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const assurance = await assignedModeratorClient.auth.mfa.getAuthenticatorAssuranceLevel();
				const denied = await storageDownload(assignedModeratorClient, upload.storage_path);
				expect(assurance.data?.currentLevel === 'aal1').toBe(true);
				expect(denied.status >= 400 && denied.bytes === null).toBe(true);
				await loginForApp(moderatorPage, assignedModerator, `/admin?case=${reportId}`);
				await moderatorPage.waitForURL((url) => url.pathname === '/auth/mfa', { timeout: 30_000 });
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 7,
					runId: configuration.runId,
					actorRole: 'assigned-moderator-aal1',
					boundary: 'Storage',
					actualResult: 'Storage denied non-2xx',
					requestId: 'not-exposed',
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('5. assigned moderator self-claims at AAL2 and reads exact evidence', async () => {
				if (!upload) {
					throw new Error('Assigned moderator precondition is missing.');
				}
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				await elevateToAal2(assignedModeratorClient, 'assigned-moderator', credentialStore);
				const claim = await assignedModeratorClient
					.from('reports')
					.update({ assigned_to: assignedModeratorId, status: 'investigating' })
					.eq('id', reportId)
					.eq('status', 'open')
					.is('assigned_to', null)
					.select('id, assigned_to, status')
					.maybeSingle();
				expect(
					!claim.error &&
						claim.data?.assigned_to === assignedModeratorId &&
						claim.data?.status === 'investigating'
				).toBe(true);
				expect(await operator.inspectAssignmentAudit(manifest, reportId, assignedModeratorId)).toBe(1);
				const millisecondsLeft = 30_000 - (Date.now() % 30_000);
				await moderatorPage.waitForTimeout(millisecondsLeft + 250);
				await moderatorPage
					.locator('#mfa-code')
					.fill(await moderatorTotpCode(credentialStore, 'assigned-moderator'));
				await moderatorPage.locator('button[type="submit"]').click();
				await moderatorPage.waitForURL((url) => url.pathname === '/admin', { timeout: 30_000 });
				const read = await storageDownload(assignedModeratorClient, upload.storage_path);
				expect(
					read.status === 200 &&
						read.bytes?.byteLength === upload.actual_byte_size &&
						createHash('sha256').update(read.bytes).digest('hex') === upload.actual_content_hash
				).toBe(true);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 5,
					runId: configuration.runId,
					actorRole: 'assigned-moderator-aal2',
					boundary: 'Storage',
					actualResult: 'Storage 200 bytes',
					requestId: 'not-exposed',
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('6. unassigned AAL2 moderator receives a real Storage denial', async () => {
				if (!upload) throw new Error('Unassigned moderator precondition is missing.');
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				await elevateToAal2(
					unassignedModeratorClient,
					'unassigned-moderator',
					credentialStore
				);
				const denied = await storageDownload(unassignedModeratorClient, upload.storage_path);
				const assignedRead = await storageDownload(assignedModeratorClient, upload.storage_path);
				expect(denied.status >= 400 && denied.bytes === null).toBe(true);
				expect(assignedRead.status === 200 && Boolean(assignedRead.bytes)).toBe(true);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 6,
					runId: configuration.runId,
					actorRole: 'unassigned-moderator-aal2',
					boundary: 'Storage',
					actualResult: 'Storage denied non-2xx',
					requestId: 'not-exposed',
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('8. exact rejected and abandoned fixtures clean while attached evidence survives', async () => {
				if (!upload) throw new Error('Cleanup lifecycle precondition is missing.');
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const fixtureCutoff = new Date().toISOString();
				const invalidTarget = '00000000-0000-4000-8000-000000000001';
				await reporterPage.goto(`/report?targetType=profile&targetId=${invalidTarget}`, {
					waitUntil: 'domcontentloaded'
				});
				await reporterPage.locator('select[name="reasonCode"]').selectOption('harassment');
				await reporterPage
					.locator('textarea[name="details"]')
					.fill(`Synthetic rejected evidence ${configuration.runId}`);
				await reporterPage.locator('input[name="evidence"]').setInputFiles({
					name: 'synthetic-rejected.png',
					mimeType: 'image/png',
					buffer: syntheticPng()
				});
				await reporterPage.locator('input[type="checkbox"]').check();
				await waitForTestingTurnstile(reporterPage);
				const rejectionPromise = reporterPage.waitForResponse(
					(response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/report'
				);
				await reporterPage.getByRole('button', { name: 'Изпрати сигнала' }).click();
				const rejectionResponse = await rejectionPromise;
				const rejectionReceipt = workerReceiptFromHeaders(
					rejectionResponse.status(),
					await rejectionResponse.allHeaders()
				);
				expect(rejectionReceipt.status >= 400).toBe(true);
				const rejected = (await operator.discoverUploadByStatus(
					manifest,
					'reporter',
					'rejected',
					fixtureCutoff
				)) as { id: string; storage_path: string };
				manifest = registerHostedUpload(manifest, rejected.id, 'reporter', rejected.storage_path);
				await persistManifest(configuration, manifest);
				const rejectedQueue = (await operator.discoverQueueForUpload(manifest, rejected.id)) as {
					id: number;
				};
				manifest = registerHostedQueueRow(manifest, rejectedQueue.id, rejected.id);
				await persistManifest(configuration, manifest);
				const manualCleanup = await operator.processCleanupQueue();
				expect(manualCleanup.status).toBe(202);
				await expect
					.poll(async () => {
						const queue = (await operator.discoverQueueForUpload(manifest, rejected.id)) as {
							processedAt: string | null;
						};
						return Boolean(queue.processedAt);
					})
					.toBe(true);
				expect(
					!((await operator.inspectObject(manifest, rejected.id)) as unknown as ObjectInspection).exists
				).toBe(true);

				const abandonedAllocation = await reporterClient.rpc('create_report_evidence_upload', {
					source_mime_type: 'image/webp',
					source_byte_size: syntheticWebp().byteLength
				});
				const abandoned = Array.isArray(abandonedAllocation.data)
					? abandonedAllocation.data[0]
					: abandonedAllocation.data;
				if (abandonedAllocation.error || !abandoned?.upload_id || !abandoned.storage_path) {
					throw new Error('Abandoned fixture allocation failed.');
				}
				manifest = registerHostedUpload(
					manifest,
					abandoned.upload_id,
					'reporter',
					abandoned.storage_path
				);
				await persistManifest(configuration, manifest);
				await operator.uploadAbandonedObject(manifest, abandoned.upload_id, syntheticWebp());
				await operator.backdateAbandonedUpload(manifest, abandoned.upload_id);
				let scheduledQueue: { id: number; processedAt: string | null } | null = null;
				await expect
					.poll(
						async () => {
							try {
								const abandonedRow = (await operator.inspectUpload(
									manifest,
									abandoned.upload_id
								)) as unknown as EvidenceUpload;
								scheduledQueue = (await operator.discoverQueueForUpload(
									manifest,
									abandoned.upload_id
								)) as { id: number; processedAt: string | null };
								return abandonedRow.status === 'expired' && Boolean(scheduledQueue.processedAt);
							} catch {
								return false;
							}
						},
						{ timeout: 7 * 60_000, intervals: [15_000] }
					)
					.toBe(true);
				const scheduledQueueReceipt = scheduledQueue as {
					id: number;
					processedAt: string | null;
				} | null;
				if (!scheduledQueueReceipt) throw new Error('Scheduled cleanup receipt is missing.');
				manifest = registerHostedQueueRow(
					manifest,
					scheduledQueueReceipt.id,
					abandoned.upload_id
				);
				await persistManifest(configuration, manifest);
				expect(
					!((await operator.inspectObject(
						manifest,
						abandoned.upload_id
					)) as unknown as ObjectInspection).exists
				).toBe(true);
				expect(
					((await operator.inspectUpload(manifest, upload.id)) as unknown as EvidenceUpload).status ===
						'attached'
				).toBe(true);
				expect((await storageDownload(reporterClient, upload.storage_path)).status).toBe(200);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				recordScenario(testInfo, {
					scenario: 8,
					runId: configuration.runId,
					actorRole: 'cleanup-operator',
					boundary: 'operator',
					actualResult: 'database transition verified',
					requestId: manualCleanup.requestId,
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('9. malformed uploads have zero exact-manifest side effects', async () => {
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const malformedBoundary = `gate3-malformed-${Date.now().toString(36)}`;
				const malformedToken = await freshReportToken(reporterPage, crossUserId);
				const malformedDetails = `Synthetic hostile upload ${configuration.runId}`;
				const malformedReceipt = await postMultipart(
					reporterPage,
					multipartBody(
						malformedBoundary,
						reportParts(crossUserId, configuration.runId, malformedToken, [syntheticPng()]),
						false
					),
					malformedBoundary,
					'Заявката за сигнал е невалидна.',
					[
						crossUserId,
						configuration.runId,
						malformedToken,
						malformedDetails,
						'hostile-0.png'
					]
				);
				expect(malformedReceipt.status).toBe(400);

				const invalidBoundary = `gate3-invalid-image-${Date.now().toString(36)}`;
				const invalidToken = await freshReportToken(reporterPage, crossUserId);
				const invalidDetails = `Synthetic hostile upload ${configuration.runId}`;
				const rejectionReceipt = await postMultipart(
					reporterPage,
					multipartBody(
						invalidBoundary,
						reportParts(crossUserId, configuration.runId, invalidToken, [
							Buffer.from('not an image')
						])
					),
					invalidBoundary,
					'Изображението не можа да бъде проверено и безопасно обработено.',
					[
						crossUserId,
						configuration.runId,
						invalidToken,
						invalidDetails,
						'hostile-0.png'
					]
				);
				expect(rejectionReceipt.status).toBe(400);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				expect(sameCounts(before, lastMeasured)).toBe(true);
				recordScenario(testInfo, {
					scenario: 9,
					runId: configuration.runId,
					actorRole: 'reporter',
					boundary: 'HTTP',
					actualResult: 'HTTP 400',
					requestId: rejectionReceipt.requestId,
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

			await test.step('10. authenticated actual-stream limits reject every hostile body', async () => {
				const before = (await operator.inspect(manifest)) as ScopedCounts;
				const perFileBoundary = `gate3-file-${Date.now().toString(36)}`;
				const perFileToken = await freshReportToken(reporterPage, crossUserId);
				const perFile = await postMultipart(
					reporterPage,
					multipartBody(
						perFileBoundary,
						reportParts(crossUserId, configuration.runId, perFileToken, [
							Buffer.alloc(MAX_EVIDENCE_BYTES + 1)
						])
					),
					perFileBoundary
				);
				expect(perFile.status).toBe(413);

				const aggregateBoundary = `gate3-aggregate-${Date.now().toString(36)}`;
				const aggregateToken = await freshReportToken(reporterPage, crossUserId);
				const aggregate = await postMultipart(
					reporterPage,
					multipartBody(
						aggregateBoundary,
						reportParts(
							crossUserId,
							configuration.runId,
							aggregateToken,
							Array.from({ length: 4 }, () => Buffer.alloc(MAX_EVIDENCE_BYTES)),
							'x'.repeat(600 * 1024)
						)
					),
					aggregateBoundary
				);
				expect(aggregate.status).toBe(413);

				const chunkedBoundary = `gate3-chunked-${Date.now().toString(36)}`;
				const chunkedToken = await freshReportToken(reporterPage, crossUserId);
				const chunked = await rawReportRequest(
					reporterContext,
					multipartBody(
						chunkedBoundary,
						reportParts(crossUserId, configuration.runId, chunkedToken, [
							Buffer.alloc(MAX_REPORT_REQUEST_BYTES + 1)
						])
					),
					chunkedBoundary,
					'chunked'
				);
				expect(chunked.status).toBe(413);

				const understatedBoundary = `gate3-understated-${Date.now().toString(36)}`;
				const understatedToken = await freshReportToken(reporterPage, crossUserId);
				const understated = await rawReportRequest(
					reporterContext,
					multipartBody(
						understatedBoundary,
						reportParts(crossUserId, configuration.runId, understatedToken, [
							Buffer.alloc(MAX_REPORT_REQUEST_BYTES + 1)
						])
					),
					understatedBoundary,
					'understated'
				);
				expect(understated.status).toBe(413);
				lastMeasured = (await operator.inspect(manifest)) as ScopedCounts;
				expect(sameCounts(before, lastMeasured)).toBe(true);
				recordScenario(testInfo, {
					scenario: 10,
					runId: configuration.runId,
					actorRole: 'reporter',
					boundary: 'HTTP',
					actualResult: 'HTTP 413',
					requestId: understated.requestId,
					before,
					after: lastMeasured,
					cleanup: 'pending-A11'
				});
			});

		} catch (error) {
			recordCleanupRequired(testInfo, configuration.runId, lastMeasured);
			throw error;
		} finally {
			await Promise.all([
				reporterClient.auth.signOut(),
				crossUserClient.auth.signOut(),
				assignedModeratorClient.auth.signOut(),
				unassignedModeratorClient.auth.signOut(),
				reporterContext.close(),
				moderatorContext.close()
			]);
		}
	});

	test('executes the checkpointed Issue #24 moderation-safety proof', async ({ browser }, testInfo) => {
		test.skip(testInfo.project.name !== 'chromium', 'Hosted mutations run once in the desktop project.');
		test.skip(!ISSUE_24_SCENARIO_ENABLED, HOSTED_SKIP_REASON);
		test.setTimeout(15 * 60_000);
		if (requiredEnvironment('E2E_REAL_TURNSTILE_TESTING') !== 'true') {
			throw new Error('Issue #24 fixtures are not approved fresh testing actors.');
		}

		const configuration = validateIssue24HostedEnvironment(process.env) as HostedConfiguration;
		if (configuration.candidateSha !== requiredEnvironment('RELEASE_COMMIT_SHA')) {
			throw new Error('Issue #24 proof candidate does not match the deployed release SHA.');
		}
		const publishableKey = requiredEnvironment('PUBLIC_SUPABASE_PUBLISHABLE_KEY');
		const conversationId = requiredEnvironment('E2E_REAL_ISSUE_24_CONVERSATION_ID');
		if (!UUID_PATTERN.test(conversationId)) throw new Error('Issue #24 conversation fixture is invalid.');
		const credentialStore = createEncryptedModeratorCredentialStore({
			filePath: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH'),
			encryptionKey: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY'),
			projectRef: configuration.target.projectRef,
			runId: configuration.runId
		});
		const serviceClient = createClient(configuration.target.supabaseUrl, configuration.serviceKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const operator = createHostedEvidenceOperator({
			config: configuration,
			adapters: createSupabaseHostedEvidenceAdapters({
				config: configuration,
				serviceClient,
				managementAccessToken: requiredEnvironment('SUPABASE_ACCESS_TOKEN'),
				cleanupSecret: requiredEnvironment('UPLOAD_CLEANUP_SECRET')
			})
		});
		const clients = Object.fromEntries(
			Object.keys(configuration.actorRoles).map((role) => [
				role,
				actorClient(publishableKey, configuration.target.supabaseUrl)
			])
		) as Record<string, SupabaseClient>;
		const actorIds = Object.fromEntries(
			await Promise.all(
				Object.entries(configuration.actorRoles).map(async ([role, credentials]) => [
					role,
					await signInActor(clients[role], credentials)
				])
			)
		) as Record<string, string>;
		if (new Set(Object.values(actorIds)).size !== 6) {
			throw new Error('Issue #24 synthetic actors are not distinct.');
		}

		let manifest = (await loadHostedRunManifest(
			configuration,
			requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH')
		)) as RunManifest;
		const reporterContext = await browser.newContext({
			baseURL: configuration.target.workerOrigin
		});
		const reporterPage = await reporterContext.newPage();
		let reportId = '';
		let uploadPath = '';
		let winnerRole: 'assigned-moderator' | 'unassigned-moderator' = 'assigned-moderator';
		let loserRole: 'assigned-moderator' | 'unassigned-moderator' = 'unassigned-moderator';
		try {
			await test.step('attest exact deployment and six fresh actors', async () => {
				const response = await reporterPage.request.get('/');
				workerReceipt(response);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'deployment-attested');
				const attestations = await Promise.all(
					Object.entries(actorIds).map(([role, userId]) =>
						operator.attestFreshActor(manifest, role, userId)
					)
				);
				if (
					manifest.actors.length !== 6 ||
					attestations.some(
						(receipt) =>
							!manifest.actors.some(
								(actor) => actor.role === receipt.role && actor.userId === receipt.userId
							)
					)
				) {
					throw new Error('Issue #24 actor provenance is invalid.');
				}
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'actors-attested');
			});

			await test.step('reporter submits private evidence and sees only the safe projection', async () => {
				await loginForApp(reporterPage, configuration.actorRoles.reporter, '/dashboard');
				await reporterPage.waitForURL((url) => url.pathname === '/dashboard', { timeout: 30_000 });
				const submission = await submitEvidenceReport(
					reporterPage,
					actorIds['cross-user'],
					configuration.runId,
					syntheticPng()
				);
				reportId = submission.reportId;
				manifest = registerHostedReport(manifest, reportId, 'reporter');
				await persistManifest(configuration, manifest);
				const discovered = (await operator.discoverUploadForReport(manifest, reportId)) as {
					id: string;
					storage_path: string;
				};
				manifest = registerHostedUpload(manifest, discovered.id, 'reporter', discovered.storage_path);
				await persistManifest(configuration, manifest);
				uploadPath = discovered.storage_path;
				const projection = await clients.reporter.rpc('list_my_reports', {
					p_page_size: 10,
					p_page_offset: 0
				});
				const row = Array.isArray(projection.data)
					? projection.data.find((entry) => entry.report_id === reportId)
					: null;
				expect(projection.error).toBeNull();
				expect(Object.keys(row ?? {}).sort()).toEqual(
					[
						'created_at',
						'evidence_count',
						'outcome',
						'reason_code',
						'report_id',
						'resolved_at',
						'status',
						'target_type',
						'updated_at'
					].sort()
				);
				expect(row).toEqual(expect.objectContaining({ report_id: reportId, status: 'open' }));
				await reporterPage.goto('/dashboard', { waitUntil: 'domcontentloaded' });
				await expect(reporterPage.getByRole('heading', { name: 'Моите сигнали' })).toBeVisible();
				await expect(reporterPage.locator('body')).not.toContainText(actorIds['assigned-moderator']);
				await expect(reporterPage.locator('body')).not.toContainText(uploadPath);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'reporter-safety');
			});

			await test.step('visible block action denies new contact and preserves history', async () => {
				const before = await clients.reporter
					.from('messages')
					.select('id', { count: 'exact', head: true })
					.eq('conversation_id', conversationId);
				expect(before.error).toBeNull();
				expect(before.count).toBeGreaterThan(0);
				await reporterPage.goto(`/messages?conversation=${encodeURIComponent(conversationId)}`, {
					waitUntil: 'domcontentloaded'
				});
				await expect(reporterPage.getByRole('button', { name: 'Блокирай контакт' })).toBeVisible();
				reporterPage.once('dialog', (dialog) => dialog.accept());
				await reporterPage.getByRole('button', { name: 'Блокирай контакт' }).click();
				await expect(
					reporterPage.getByText('Контактът е блокиран. Нови съобщения не могат да бъдат изпращани.')
				).toBeVisible();
				await expect(reporterPage.locator('textarea[name="body"]')).toBeDisabled();
				const deniedSend = await clients['cross-user'].from('messages').insert({
					conversation_id: conversationId,
					sender_id: actorIds['cross-user'],
					body: `Issue 24 blocked contact ${configuration.runId}`
				});
				expect(deniedSend.error).not.toBeNull();
				const after = await clients.reporter
					.from('messages')
					.select('id', { count: 'exact', head: true })
					.eq('conversation_id', conversationId);
				expect(after.error).toBeNull();
				expect(after.count).toBe(before.count);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'block-enforced');
			});

			await test.step('counterparty and AAL1 staff remain denied from every private boundary', async () => {
				const crossReport = await clients['cross-user'].from('reports').select('*').eq('id', reportId);
				const crossAudit = await clients['cross-user']
					.from('moderation_audit')
					.select('*')
					.eq('report_id', reportId);
				const crossEvidence = await storageDownload(clients['cross-user'], uploadPath);
				expect(crossReport.error).not.toBeNull();
				expect(crossAudit.error).not.toBeNull();
				expect(crossEvidence.status).not.toBe(200);

				const aal1 = clients['aal1-staff'];
				const deniedOperations = await Promise.all([
					aal1.rpc('list_moderation_report_queue', { p_page_size: 10, p_page_offset: 0 }),
					aal1.rpc('claim_moderation_report', { p_report_id: reportId }),
					aal1.rpc('get_assigned_moderation_case', { p_report_id: reportId }),
					aal1.rpc('moderate_profile', {
						report_case_id: reportId,
						target_profile_id: actorIds['cross-user'],
						suspend_profile: true,
						moderation_rationale: 'Issue 24 AAL1 denial proof'
					}),
					aal1.storage.from('report-evidence').createSignedUrl(uploadPath, 60)
				]);
				expect(deniedOperations.every((result) => Boolean(result.error))).toBe(true);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'privacy-denials');
			});

			await test.step('AAL2 staff see only safe summaries before exact assignment', async () => {
				await Promise.all([
					elevateToAal2(clients['assigned-moderator'], 'assigned-moderator', credentialStore),
					elevateToAal2(clients['unassigned-moderator'], 'unassigned-moderator', credentialStore),
					elevateToAal2(clients['unassigned-admin'], 'unassigned-admin', credentialStore)
				]);
				for (const role of ['assigned-moderator', 'unassigned-moderator', 'unassigned-admin']) {
					const queue = await clients[role].rpc('list_moderation_report_queue', {
						p_page_size: 20,
						p_page_offset: 0
					});
					const row = Array.isArray(queue.data)
						? queue.data.find((entry) => entry.report_id === reportId)
						: null;
					expect(queue.error).toBeNull();
					expect(Object.keys(row ?? {}).sort()).toEqual(
						[
							'assignment_state',
							'created_at',
							'reason_code',
							'report_id',
							'status',
							'target_type'
						].sort()
					);
					const detail = await clients[role].rpc('get_assigned_moderation_case', {
						p_report_id: reportId
					});
					expect(detail.error).not.toBeNull();
					expect((await storageDownload(clients[role], uploadPath)).status).not.toBe(200);
					expect(
						(await clients[role].storage.from('report-evidence').createSignedUrl(uploadPath, 60)).error
					).not.toBeNull();
					expect(
						(
							await clients[role].rpc('moderate_profile', {
								report_case_id: reportId,
								target_profile_id: actorIds['cross-user'],
								suspend_profile: true,
								moderation_rationale: 'Issue 24 unassigned AAL2 denial proof'
							})
						).error
					).not.toBeNull();
				}
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'queue-privacy');
			});

			await test.step('two moderators race atomically and only the winner gains the case', async () => {
				const racerRoles = ['assigned-moderator', 'unassigned-moderator'] as const;
				const claims = await Promise.all(
					racerRoles.map((role) =>
						clients[role].rpc('claim_moderation_report', { p_report_id: reportId })
					)
				);
				const winnerIndex = claims.findIndex(
					(result) => !result.error && result.data === 'claimed'
				);
				expect(winnerIndex).toBeGreaterThanOrEqual(0);
				expect(claims.every((result) => !result.error)).toBe(true);
				expect(claims.filter((result) => result.data === 'claimed')).toHaveLength(1);
				expect(claims.filter((result) => result.data === 'unavailable')).toHaveLength(1);
				winnerRole = racerRoles[winnerIndex];
				loserRole = racerRoles[1 - winnerIndex];
				const retry = await clients[winnerRole].rpc('claim_moderation_report', {
					p_report_id: reportId
				});
				expect(retry).toEqual(
					expect.objectContaining({ data: 'already_claimed_by_you', error: null })
				);
				expect(
					await operator.inspectAssignmentAudit(manifest, reportId, actorIds[winnerRole])
				).toBe(1);
				for (const role of [loserRole, 'unassigned-admin']) {
					const denied = await clients[role].rpc('get_assigned_moderation_case', {
						p_report_id: reportId
					});
					expect(denied.error).not.toBeNull();
					expect(
						(
							await clients[role].rpc('moderate_profile', {
								report_case_id: reportId,
								target_profile_id: actorIds['cross-user'],
								suspend_profile: true,
								moderation_rationale: 'Issue 24 post-claim denial proof'
							})
						).error
					).not.toBeNull();
				}
				const detail = await clients[winnerRole].rpc('get_assigned_moderation_case', {
					p_report_id: reportId
				});
				expect(detail.error).toBeNull();
				expect(detail.data).toEqual([
					expect.objectContaining({
						report_id: reportId,
						reporter_id: actorIds.reporter,
						target_id: actorIds['cross-user'],
						assigned_to: actorIds[winnerRole]
					})
				]);
				expect((await storageDownload(clients[winnerRole], uploadPath)).status).toBe(200);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'claim-race');
			});

			await test.step('assigned decision commits target, report, actor, and audit atomically', async () => {
				const decision = await clients[winnerRole].rpc('moderate_profile', {
					report_case_id: reportId,
					target_profile_id: actorIds['cross-user'],
					suspend_profile: true,
					moderation_rationale: 'Issue 24 exact assigned hosted decision'
				});
				expect(decision.error).toBeNull();
				const [report, target, audit] = await Promise.all([
					serviceClient
						.from('reports')
						.select('id,status,assigned_to,resolution_code,resolved_at')
						.eq('id', reportId)
						.single(),
					serviceClient.from('profiles').select('id,is_suspended').eq('id', actorIds['cross-user']).single(),
					serviceClient
						.from('moderation_audit')
						.select('id,action,actor_id,report_id,target_id,rationale')
						.eq('report_id', reportId)
						.order('id', { ascending: true })
				]);
				expect(report.error).toBeNull();
				expect(target.error).toBeNull();
				expect(audit.error).toBeNull();
				expect(report.data).toEqual(
					expect.objectContaining({
						id: reportId,
						status: 'resolved',
						assigned_to: actorIds[winnerRole],
						resolution_code: 'user_suspended'
					})
				);
				expect(target.data).toEqual(
					expect.objectContaining({ id: actorIds['cross-user'], is_suspended: true })
				);
				expect(audit.data?.filter((entry) => entry.action === 'report_assigned')).toHaveLength(1);
				expect(audit.data?.some((entry) => entry.actor_id === actorIds[winnerRole])).toBe(true);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'decision-committed');
			});

			await test.step('reporter sees only the safe outcome and direct mutations stay denied', async () => {
				const projection = await clients.reporter.rpc('list_my_reports', {
					p_page_size: 10,
					p_page_offset: 0
				});
				const row = Array.isArray(projection.data)
					? projection.data.find((entry) => entry.report_id === reportId)
					: null;
				expect(row).toEqual(
					expect.objectContaining({
						report_id: reportId,
						status: 'resolved',
						outcome: 'action_taken'
					})
				);
				expect(JSON.stringify(row)).not.toContain(actorIds[winnerRole]);
				expect(JSON.stringify(row)).not.toContain(uploadPath);
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'reporter-outcome');

				const directAssignment = await clients[winnerRole]
					.from('reports')
					.update({ assigned_to: actorIds[loserRole], status: 'investigating' })
					.eq('id', reportId);
				const auditUpdate = await clients[winnerRole]
					.from('moderation_audit')
					.update({ rationale: 'forbidden hosted mutation' })
					.eq('report_id', reportId);
				const auditDelete = await clients[winnerRole]
					.from('moderation_audit')
					.delete()
					.eq('report_id', reportId);
				expect(directAssignment.error).not.toBeNull();
				expect(auditUpdate.error).not.toBeNull();
				expect(auditDelete.error).not.toBeNull();
				manifest = await persistIssue24Checkpoint(configuration, manifest, 'mutation-denials');
			});
		} finally {
			await Promise.all([
				...Object.values(clients).map((client) => client.auth.signOut()),
				reporterContext.close()
			]);
		}
	});

	test('cleans only the persisted A10 manifest under A11', async ({}, testInfo) => {
		test.skip(testInfo.project.name !== 'chromium', 'Hosted mutations run once in the desktop project.');
		test.skip(!HOSTED_CLEANUP_ENABLED, HOSTED_SKIP_REASON);
		const configuration = validateHostedCleanupEnvironment(process.env) as HostedConfiguration;
		const credentialStore = createEncryptedModeratorCredentialStore({
			filePath: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH'),
			encryptionKey: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY'),
			projectRef: configuration.target.projectRef,
			runId: configuration.runId
		});
		const adapters = createSupabaseHostedEvidenceAdapters({
			config: configuration,
			serviceClient: createClient(configuration.target.supabaseUrl, configuration.serviceKey, {
				auth: { autoRefreshToken: false, persistSession: false }
			}),
			managementAccessToken: requiredEnvironment('SUPABASE_ACCESS_TOKEN'),
			cleanupSecret: requiredEnvironment('UPLOAD_CLEANUP_SECRET')
		});
		const operator = createHostedEvidenceOperator({ config: configuration, adapters });
		await cleanupHostedManifestFile({
			config: configuration,
			environment: process.env,
			manifestPath: requiredEnvironment('E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH'),
			operator,
			credentialStore,
			logger: {
				info(record) {
					testInfo.annotations.push({
						type: 'gate3-cleanup',
						description: JSON.stringify(record)
					});
				}
			}
		});
	});
});
