import { describe, expect, it, vi } from 'vitest';
import { actions } from '../../src/routes/login/+page.server';

const runtime: App.Locals['runtime'] = {
	mode: 'production',
	demoMode: false,
	appEnvironment: 'development',
	publicSupabaseUrl: 'https://market.supabase.co',
	publicSupabaseKey: 'browser-publishable-key',
	publicSupabaseAnonKey: 'browser-publishable-key',
	imageProcessorMode: 'disabled'
};

function loginForm(token = 'login-token'): FormData {
	const formData = new FormData();
	formData.set('email', ' Member@Example.BG ');
	formData.set('password', 'correct-horse-battery-staple');
	formData.set('next', '/messages');
	if (token) formData.set('cf-turnstile-response', token);
	return formData;
}

function registrationForm(token = 'registration-token'): FormData {
	const formData = new FormData();
	formData.set('email', ' New.Member@Example.BG ');
	formData.set('password', 'correct-horse-battery-staple');
	formData.set('username', 'scent_archive');
	formData.set('kind', 'merchant');
	formData.set('ageAccepted', 'on');
	formData.set('next', '/dashboard');
	if (token) formData.set('cf-turnstile-response', token);
	return formData;
}

function actionEvent(path: string, formData: FormData, supabase: unknown, providerFetch = vi.fn()) {
	return {
		request: new Request(`https://market.example${path}`, { method: 'POST', body: formData }),
		url: new URL(`https://market.example${path}`),
		fetch: providerFetch,
		locals: { runtime, supabase }
	} as never;
}

describe('Supabase-owned authentication CAPTCHA', () => {
	it('passes the login token exactly once to Supabase Auth without calling app Siteverify', async () => {
		const providerFetch = vi.fn();
		const signInWithPassword = vi.fn(async () => ({ data: { user: null, session: null }, error: new Error('invalid') }));

		const result = await actions.login(
			actionEvent('/login?/login', loginForm('single-use-login-token'), {
				auth: { signInWithPassword }
			}, providerFetch)
		);

		expect(result).toMatchObject({ status: 400, data: { success: false } });
		expect(providerFetch).not.toHaveBeenCalled();
		expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
			email: 'member@example.bg',
			password: 'correct-horse-battery-staple',
			options: { captchaToken: 'single-use-login-token' }
		});
	});

	it.each([
		['missing', ''],
		['blank', '   '],
		['oversized', 'x'.repeat(2049)]
	])('rejects a %s login token before Supabase Auth', async (_, token) => {
		const signInWithPassword = vi.fn();
		const result = await actions.login(
			actionEvent('/login?/login', loginForm(token), { auth: { signInWithPassword } })
		);

		expect(result).toMatchObject({ status: 400, data: { success: false } });
		expect(signInWithPassword).not.toHaveBeenCalled();
	});

	it('does not claim open registration during a successful login and preserves active routing', async () => {
		const signInWithPassword = vi.fn(async () => ({ data: { user: { id: 'user-1' }, session: {} }, error: null }));
		const rpc = vi.fn(async (name: string) => {
			if (name === 'get_my_beta_access') {
				return {
					data: [{
						profile_id: 'user-1',
						membership_status: 'active',
						onboarding_completed_at: '2026-09-01T10:00:00Z',
						has_current_consents: true,
						is_active: true
					}],
					error: null
				};
			}
			throw new Error(`Unexpected RPC: ${name}`);
		});
		const supabase = {
			auth: {
				signInWithPassword,
				getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
				mfa: {
					getAuthenticatorAssuranceLevel: vi.fn(async () => ({
						data: { currentLevel: 'aal1', nextLevel: 'aal1' },
						error: null
					}))
				}
			},
			from: vi.fn(() => ({
				select: () => ({
					eq: () => ({
						maybeSingle: async () => ({
							data: { id: 'user-1', username: 'member', role: 'user' },
							error: null
						})
					})
				})
			})),
			rpc
		};

		await expect(
			actions.login(actionEvent('/login?/login', loginForm(), supabase))
		).rejects.toMatchObject({ status: 303, location: '/messages' });
		expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_my_beta_access']);
	});

	it('passes the registration token directly to signUp without redirect data or app Siteverify', async () => {
		const providerFetch = vi.fn();
		const signUp = vi.fn(async () => ({ data: { user: { id: 'new-user' }, session: null }, error: null }));

		const result = await actions.register(
			actionEvent('/login?/register', registrationForm('single-use-registration-token'), {
				auth: { signUp }
			}, providerFetch)
		);

		expect(providerFetch).not.toHaveBeenCalled();
		expect(signUp).toHaveBeenCalledExactlyOnceWith({
			email: 'new.member@example.bg',
			password: 'correct-horse-battery-staple',
			options: {
				captchaToken: 'single-use-registration-token',
				data: { username: 'scent_archive', account_kind: 'merchant' }
			}
		});
		expect(result).toMatchObject({ success: true, email: 'new.member@example.bg' });
	});

	it.each([
		['missing', ''],
		['blank', '   '],
		['oversized', 'x'.repeat(2049)]
	])('rejects a %s registration token before Supabase Auth', async (_, token) => {
		const signUp = vi.fn();
		const result = await actions.register(
			actionEvent('/login?/register', registrationForm(token), { auth: { signUp } })
		);

		expect(result).toMatchObject({ status: 400, data: { success: false } });
		expect(signUp).not.toHaveBeenCalled();
	});

	it('signs out and fails closed when signUp unexpectedly creates a session', async () => {
		const signUp = vi.fn(async () => ({
			data: { user: { id: 'new-user' }, session: { access_token: 'unexpected' } },
			error: null
		}));
		const signOut = vi.fn(async () => {
			throw new Error('sign-out transport failed');
		});
		const rpc = vi.fn();

		const result = await actions.register(
			actionEvent('/login?/register', registrationForm(), {
				auth: { signUp, signOut },
				rpc
			})
		);

		expect(result).toMatchObject({ status: 503, data: { success: false } });
		expect(signOut).toHaveBeenCalledOnce();
		expect(rpc).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain('unexpected');
	});
});
