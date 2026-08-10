import type { RequestEvent } from '@sveltejs/kit';
import type { ProductionRuntimeConfiguration } from '$lib/server/env';

const VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const CLOUDFLARE_ALWAYS_PASS_TEST_SITE_KEY = '1x00000000000000000000AA';
const CLOUDFLARE_ALWAYS_PASS_TEST_SECRET_KEY =
	'1x0000000000000000000000000000000AA';

interface TurnstileApiResponse {
	success?: boolean;
	hostname?: string;
	action?: string;
	['error-codes']?: string[];
}

export interface TurnstileVerificationResult {
	success: boolean;
	reason?: 'missing_token' | 'not_configured' | 'network_error' | 'rejected';
	errorCodes?: readonly string[];
}

function acceptsCloudflareTestingReceipt(
	runtime: ProductionRuntimeConfiguration
): boolean {
	return (
		runtime.appEnvironment === 'staging' &&
		runtime.publicTurnstileSiteKey === CLOUDFLARE_ALWAYS_PASS_TEST_SITE_KEY &&
		runtime.turnstileSecretKey === CLOUDFLARE_ALWAYS_PASS_TEST_SECRET_KEY
	);
}

export async function verifyTurnstile(options: {
	token: string | null | undefined;
	secretKey: string | null | undefined;
	remoteIp?: string;
	expectedAction?: string;
	expectedHostname?: string;
	acceptCloudflareTestingReceipt?: boolean;
	fetch?: typeof globalThis.fetch;
}): Promise<TurnstileVerificationResult> {
	const token = options.token?.trim();
	const secretKey = options.secretKey?.trim();
	if (!secretKey) return { success: false, reason: 'not_configured' };
	if (!token) return { success: false, reason: 'missing_token' };

	const payload = new URLSearchParams({ secret: secretKey, response: token });
	if (options.remoteIp) payload.set('remoteip', options.remoteIp);

	try {
		const response = await (options.fetch ?? globalThis.fetch)(VERIFY_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: payload.toString(),
			signal: AbortSignal.timeout(8_000)
		});
		if (!response.ok) return { success: false, reason: 'network_error' };

		const result = (await response.json()) as TurnstileApiResponse;
		const isCloudflareTestingReceipt =
			options.acceptCloudflareTestingReceipt === true &&
			result.success === true &&
			result.action === 'test' &&
			result.hostname === 'localhost';

		if (isCloudflareTestingReceipt) return { success: true };

		const matchesAction = !options.expectedAction || result.action === options.expectedAction;
		const matchesHostname =
			!options.expectedHostname || result.hostname === options.expectedHostname;

		if (result.success === true && matchesAction && matchesHostname) return { success: true };
		return {
			success: false,
			reason: 'rejected',
			errorCodes: result['error-codes'] ?? []
		};
	} catch {
		return { success: false, reason: 'network_error' };
	}
}

export async function verifyTurnstileForAction(
	event: Pick<RequestEvent, 'fetch' | 'getClientAddress'>,
	formData: FormData,
	runtime: ProductionRuntimeConfiguration,
	expectedAction: string
): Promise<TurnstileVerificationResult> {
	let remoteIp: string | undefined;
	try {
		remoteIp = event.getClientAddress();
	} catch {
		// Some local adapters do not expose a client address. Turnstile accepts requests without it.
	}

	return verifyTurnstile({
		token: formData.get('cf-turnstile-response')?.toString(),
		secretKey: runtime.turnstileSecretKey,
		remoteIp,
		expectedAction,
		expectedHostname: runtime.turnstileExpectedHostname,
		acceptCloudflareTestingReceipt: acceptsCloudflareTestingReceipt(runtime),
		fetch: event.fetch
	});
}
