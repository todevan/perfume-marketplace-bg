import { describe, expect, it, vi } from 'vitest';
import { verifyHostedAuthConfig } from '../../scripts/verify-hosted-auth-config.mjs';

describe('hosted Auth configuration evidence', () => {
	it('requires target-locked open confirmed email registration with Turnstile at Auth', async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
			disable_signup: false,
			external_email_enabled: true,
			external_phone_enabled: false,
			external_anonymous_users_enabled: false,
			mailer_autoconfirm: false,
			security_captcha_enabled: true,
			security_captcha_provider: 'turnstile'
		}), { status: 200 }));

		await expect(verifyHostedAuthConfig({
			projectRef: 'nuhkpqjjyuygiemrxbdp',
			accessToken: 'management-token',
			fetchImpl
		})).resolves.toEqual({ projectRef: 'nuhkpqjjyuygiemrxbdp', captchaProvider: 'turnstile' });
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://api.supabase.com/v1/projects/nuhkpqjjyuygiemrxbdp/config/auth',
			expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer management-token' }) })
		);
	});

	it.each([
		[{ security_captcha_enabled: false }, 'CAPTCHA must be enabled'],
		[{ security_captcha_provider: 'hcaptcha' }, 'CAPTCHA provider must be turnstile'],
		[{ mailer_autoconfirm: true }, 'Email confirmation must remain required']
	])('fails closed for unsafe hosted Auth state %#', async (override, message) => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
			disable_signup: false,
			external_email_enabled: true,
			external_phone_enabled: false,
			external_anonymous_users_enabled: false,
			mailer_autoconfirm: false,
			security_captcha_enabled: true,
			security_captcha_provider: 'turnstile',
			...override
		}), { status: 200 }));
		await expect(verifyHostedAuthConfig({ projectRef: 'nuhkpqjjyuygiemrxbdp', accessToken: 'token', fetchImpl })).rejects.toThrow(message);
	});
});
