import { afterEach, describe, expect, it, vi } from 'vitest';
import { actions as loginActions } from '../../src/routes/login/+page.server';
import { actions as resetPasswordActions } from '../../src/routes/auth/reset-password/+page.server';

const runtime: App.Locals['runtime'] = {
	mode: 'production',
	demoMode: false,
	appEnvironment: 'development',
	publicSupabaseUrl: 'https://market.supabase.co',
	publicSupabaseKey: 'browser-publishable-key',
	publicSupabaseAnonKey: 'browser-publishable-key',
	imageProcessorMode: 'disabled',
	turnstileSecretKey: 'turnstile-secret-key',
	turnstileExpectedHostname: 'market.example'
};

afterEach(() => {
	vi.restoreAllMocks();
});

function oversizedForm(fields: Record<string, string>): FormData {
	const formData = new FormData();
	for (const [name, value] of Object.entries(fields)) formData.set(name, value);
	formData.set('padding', 'x'.repeat(65 * 1024));
	return formData;
}

function formRequest(path: string, formData: FormData): Request {
	return new Request(`https://market.example${path}`, { method: 'POST', body: formData });
}

function actionStatus(result: unknown): number | undefined {
	return result !== null && typeof result === 'object' && 'status' in result
		? (result as { status?: number }).status
		: undefined;
}

const genericPasswordResetSuccess = {
	success: true,
	message: 'Ако има профил с този имейл, ще получиш връзка за нова парола.'
};

function passwordResetForm(token?: string): FormData {
	const formData = new FormData();
	formData.set('email', ' Member@Example.BG ');
	if (token !== undefined) formData.set('cf-turnstile-response', token);
	return formData;
}

function passwordResetEvent(formData: FormData, resetPasswordForEmail: unknown, providerFetch = vi.fn()) {
	return {
		request: formRequest('/auth/reset-password', formData),
		url: new URL('https://market.example/auth/reset-password'),
		fetch: providerFetch,
		locals: { runtime, supabase: { auth: { resetPasswordForEmail } } }
	};
}

describe('anonymous auth action request-body limits', () => {
	it('rejects an oversized login before Turnstile verification or password sign-in', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'login', hostname: 'market.example' }))
		);
		const signInWithPassword = vi.fn(async () => ({ error: new Error('invalid credentials') }));

		const result = await loginActions.login({
			request: formRequest(
				'/login?/login',
				oversizedForm({
					email: 'member@example.bg',
					password: 'correct-horse-battery-staple',
					'cf-turnstile-response': 'verified-login-token'
				})
			),
			url: new URL('https://market.example/login?/login'),
			fetch: turnstileFetch,
			locals: { runtime, supabase: { auth: { signInWithPassword } } }
		} as never);

		expect({
			status: actionStatus(result),
			turnstileRequests: turnstileFetch.mock.calls.length,
			signInAttempts: signInWithPassword.mock.calls.length
		}).toEqual({ status: 413, turnstileRequests: 0, signInAttempts: 0 });
	});

	it('rejects an oversized registration before Turnstile verification or account creation', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'register' }))
		);
		const signUp = vi.fn(async () => ({ data: { user: { id: 'new-user' }, session: null }, error: null }));

		const result = await loginActions.register({
			request: formRequest(
				'/login?/register',
				oversizedForm({
					email: 'member@example.bg',
					password: 'correct-horse-battery-staple',
					username: 'scent_archive',
					ageAccepted: 'on',
					'cf-turnstile-response': 'verified-registration-token'
				})
			),
			url: new URL('https://market.example/login?/register'),
			fetch: turnstileFetch,
			locals: { runtime, supabase: { auth: { signUp } } }
		} as never);

		expect({
			status: actionStatus(result),
			turnstileRequests: turnstileFetch.mock.calls.length,
			signUpAttempts: signUp.mock.calls.length
		}).toEqual({ status: 413, turnstileRequests: 0, signUpAttempts: 0 });
	});

	it('rejects an oversized password-reset request before Turnstile verification or reset email', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'password_reset', hostname: 'market.example' }))
		);
		const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));

		const result = await resetPasswordActions.default({
			request: formRequest(
				'/auth/reset-password',
				oversizedForm({
					email: 'member@example.bg',
					'cf-turnstile-response': 'verified-reset-token'
				})
			),
			url: new URL('https://market.example/auth/reset-password'),
			fetch: turnstileFetch,
			locals: { runtime, supabase: { auth: { resetPasswordForEmail } } }
		} as never);

		expect({
			status: actionStatus(result),
			turnstileRequests: turnstileFetch.mock.calls.length,
			resetEmailAttempts: resetPasswordForEmail.mock.calls.length
		}).toEqual({ status: 413, turnstileRequests: 0, resetEmailAttempts: 0 });
	});

	it.each([
		['login', loginActions.login, '/login?/login'],
		['registration', loginActions.register, '/login?/register'],
		['password reset', resetPasswordActions.default, '/auth/reset-password']
	] as const)('rejects a malformed %s form before external authentication operations', async (_, action, path) => {
		const turnstileFetch = vi.fn();
		const signInWithPassword = vi.fn();
		const signUp = vi.fn();
		const resetPasswordForEmail = vi.fn();

		const result = await action({
			request: new Request(`https://market.example${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			}),
			url: new URL(`https://market.example${path}`),
			fetch: turnstileFetch,
			locals: {
				runtime,
				supabase: { auth: { signInWithPassword, signUp, resetPasswordForEmail } }
			}
		} as never);

		expect(actionStatus(result)).toBe(400);
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(signInWithPassword).not.toHaveBeenCalled();
		expect(signUp).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('keeps a within-limit login able to reach Turnstile and the provider', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'login', hostname: 'market.example' }))
		);
		const signInWithPassword = vi.fn(async () => ({ error: new Error('invalid credentials') }));
		const formData = new FormData();
		formData.set('email', 'member@example.bg');
		formData.set('password', 'correct-horse-battery-staple');
		formData.set('cf-turnstile-response', 'verified-login-token');

		const result = await loginActions.login({
			request: formRequest('/login?/login', formData),
			url: new URL('https://market.example/login?/login'),
			fetch: turnstileFetch,
			locals: { runtime, supabase: { auth: { signInWithPassword } } }
		} as never);

		expect(result).toMatchObject({ status: 400, data: { success: false } });
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(signInWithPassword).toHaveBeenCalledWith({
			email: 'member@example.bg',
			password: 'correct-horse-battery-staple',
			options: { captchaToken: 'verified-login-token' }
		});
	});

	it('preserves invalid-email rejection before CAPTCHA or password-recovery provider work', async () => {
		const turnstileFetch = vi.fn();
		const resetPasswordForEmail = vi.fn();
		const formData = passwordResetForm('verified-reset-token');
		formData.set('email', 'not-an-email');

		const result = await resetPasswordActions.default(
			passwordResetEvent(formData, resetPasswordForEmail, turnstileFetch) as never
		);

		expect(result).toMatchObject({
			status: 400,
			data: { success: false, email: 'not-an-email', message: 'Въведи валиден имейл.' }
		});
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('preserves demo password recovery without CAPTCHA or network work', async () => {
		const turnstileFetch = vi.fn();
		const resetPasswordForEmail = vi.fn();

		const result = await resetPasswordActions.default({
			request: formRequest('/auth/reset-password', passwordResetForm()),
			url: new URL('https://market.example/auth/reset-password'),
			fetch: turnstileFetch,
			locals: {
				runtime: { ...runtime, mode: 'demo', demoMode: true },
				supabase: { auth: { resetPasswordForEmail } }
			}
		} as never);

		expect(result).toEqual({ success: true, message: 'Демо режимът не изпраща имейли.' });
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('preserves unavailable password recovery when Supabase is missing', async () => {
		const turnstileFetch = vi.fn();

		const result = await resetPasswordActions.default({
			request: formRequest('/auth/reset-password', passwordResetForm('verified-reset-token')),
			url: new URL('https://market.example/auth/reset-password'),
			fetch: turnstileFetch,
			locals: { runtime, supabase: null }
		} as never);

		expect(result).toMatchObject({
			status: 503,
			data: {
				success: false,
				email: 'member@example.bg',
				message: 'Възстановяването временно не е достъпно.'
			}
		});
		expect(turnstileFetch).not.toHaveBeenCalled();
	});

	it('forwards exactly one bounded CAPTCHA token to password recovery without app Siteverify', async () => {
		const turnstileFetch = vi.fn();
		const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
		const formData = passwordResetForm('verified-reset-token');

		const result = await resetPasswordActions.default(
			passwordResetEvent(formData, resetPasswordForEmail, turnstileFetch) as never
		);

		expect(result).toEqual(genericPasswordResetSuccess);
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).toHaveBeenCalledOnce();
		expect(resetPasswordForEmail).toHaveBeenCalledWith('member@example.bg', {
			redirectTo: 'https://market.example/auth/callback?next=%2Fauth%2Fupdate-password',
			captchaToken: 'verified-reset-token'
		});
	});

	it.each([
		['missing', undefined],
		['blank', '  \t  '],
		['oversized', 'x'.repeat(2_049)]
	])('rejects a %s password-reset CAPTCHA token before provider recovery', async (_, token) => {
		const turnstileFetch = vi.fn();
		const resetPasswordForEmail = vi.fn();

		const result = await resetPasswordActions.default(
			passwordResetEvent(passwordResetForm(token), resetPasswordForEmail, turnstileFetch) as never
		);

		expect(result).toMatchObject({ status: 400, data: { success: false, email: 'member@example.bg' } });
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('rejects duplicate password-reset CAPTCHA tokens before provider recovery', async () => {
		const turnstileFetch = vi.fn();
		const resetPasswordForEmail = vi.fn();
		const formData = passwordResetForm('first-reset-token');
		formData.append('cf-turnstile-response', 'second-reset-token');

		const result = await resetPasswordActions.default(
			passwordResetEvent(formData, resetPasswordForEmail, turnstileFetch) as never
		);

		expect(result).toMatchObject({ status: 400, data: { success: false, email: 'member@example.bg' } });
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('keeps provider-rejected password recovery non-enumerating and emits only a sanitized event', async () => {
		const providerError = new Error('recipient member@example.bg does not exist; token=private-token');
		const resetPasswordForEmail = vi.fn(async () => ({ data: null, error: providerError }));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await resetPasswordActions.default(
			passwordResetEvent(passwordResetForm('verified-reset-token'), resetPasswordForEmail) as never
		);

		expect(result).toEqual(genericPasswordResetSuccess);
		expect(consoleError).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({ level: 'error', event: 'password_reset_provider_rejected' })
		);
		expect(JSON.stringify(result)).not.toMatch(/member@example\.bg|private-token|does not exist/iu);
	});

	it('keeps password-recovery transport failures non-enumerating and emits only a sanitized event', async () => {
		const resetPasswordForEmail = vi.fn(async () => {
			throw new Error('transport failed for member@example.bg with private-token');
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await resetPasswordActions.default(
			passwordResetEvent(passwordResetForm('verified-reset-token'), resetPasswordForEmail) as never
		);

		expect(result).toEqual(genericPasswordResetSuccess);
		expect(consoleError).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({ level: 'error', event: 'password_reset_provider_transport_failed' })
		);
		expect(JSON.stringify(result)).not.toMatch(/member@example\.bg|private-token|transport failed/iu);
	});
});
