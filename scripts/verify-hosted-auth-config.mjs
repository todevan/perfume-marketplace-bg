import { pathToFileURL } from 'node:url';

const STAGING_PROJECT_REF = 'nuhkpqjjyuygiemrxbdp';

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function assertState(condition, message) {
	if (!condition) throw new Error(message);
}

/**
 * @param {{ projectRef: string, accessToken: string, fetchImpl?: typeof fetch }} options
 */
export async function verifyHostedAuthConfig({ projectRef, accessToken, fetchImpl = fetch }) {
	assertState(projectRef === STAGING_PROJECT_REF, 'Unexpected Supabase project target.');
	assertState(typeof accessToken === 'string' && accessToken.trim().length > 0, 'Supabase management access token is required.');
	const response = await fetchImpl(
		`https://api.supabase.com/v1/projects/${STAGING_PROJECT_REF}/config/auth`,
		{
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${accessToken.trim()}`,
				'user-agent': 'aromatika-hosted-auth-config-evidence/1.0'
			},
			signal: AbortSignal.timeout(10_000)
		}
	);
	assertState(response.status === 200, 'Hosted Auth configuration evidence request failed.');
	const state = await response.json();
	assertState(state.disable_signup === false, 'Email signup must be globally enabled.');
	assertState(state.external_email_enabled === true, 'Email/password signup must be enabled.');
	assertState(state.external_phone_enabled === false, 'Phone signup must remain disabled.');
	assertState(state.external_anonymous_users_enabled === false, 'Anonymous signup must remain disabled.');
	assertState(state.mailer_autoconfirm === false, 'Email confirmation must remain required.');
	assertState(state.security_captcha_enabled === true, 'CAPTCHA must be enabled at Supabase Auth.');
	assertState(state.security_captcha_provider === 'turnstile', 'CAPTCHA provider must be turnstile.');
	return { projectRef: STAGING_PROJECT_REF, captchaProvider: 'turnstile' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	verifyHostedAuthConfig({
		projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF ?? STAGING_PROJECT_REF,
		accessToken: process.env.SUPABASE_ACCESS_TOKEN ?? ''
	})
		.then((receipt) => console.log(`Hosted Auth config verified for ${receipt.projectRef}: ${receipt.captchaProvider}.`))
		.catch((cause) => {
			console.error(`Hosted Auth config verification failed: ${cause instanceof Error ? cause.message : 'unknown error'}`);
			process.exitCode = 1;
		});
}
