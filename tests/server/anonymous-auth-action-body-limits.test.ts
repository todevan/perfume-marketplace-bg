import { describe, expect, it, vi } from 'vitest';
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
	turnstileSecretKey: 'turnstile-secret-key'
};

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

describe('anonymous auth action request-body limits', () => {
	it('rejects an oversized login before Turnstile verification or password sign-in', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'login' }))
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
			new Response(JSON.stringify({ success: true, action: 'password_reset' }))
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

	it('passes a within-limit login CAPTCHA token once to Supabase Auth', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'login' }))
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
		expect(signInWithPassword).toHaveBeenCalledOnce();
		expect(signInWithPassword.mock.calls[0]?.[0]).toMatchObject({
			email: 'member@example.bg',
			options: { captchaToken: 'verified-login-token' }
		});
	});

	it('passes a within-limit password-reset CAPTCHA token once to Supabase Auth', async () => {
		const turnstileFetch = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'password_reset' }))
		);
		const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
		const formData = new FormData();
		formData.set('email', 'member@example.bg');
		formData.set('cf-turnstile-response', 'verified-reset-token');

		const result = await resetPasswordActions.default({
			request: formRequest('/auth/reset-password', formData),
			url: new URL('https://market.example/auth/reset-password'),
			fetch: turnstileFetch,
			locals: { runtime, supabase: { auth: { resetPasswordForEmail } } }
		} as never);

		expect(result).toMatchObject({ success: true });
		expect(turnstileFetch).not.toHaveBeenCalled();
		expect(resetPasswordForEmail).toHaveBeenCalledWith('member@example.bg', {
			redirectTo: 'https://market.example/auth/callback?next=%2Fauth%2Fupdate-password',
			captchaToken: 'verified-reset-token'
		});
	});
});
