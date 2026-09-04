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

function actionEvent(
	path: string,
	formData: FormData,
	supabase: unknown,
	providerFetch = vi.fn(),
	cookies: unknown = { getAll: () => [], set: vi.fn() }
) {
	return {
		request: new Request(`https://market.example${path}`, { method: 'POST', body: formData }),
		url: new URL(`https://market.example${path}`),
		fetch: providerFetch,
		cookies,
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

	it('recovers a confirmed account with no membership and routes the claimed account to onboarding', async () => {
		const signInWithPassword = vi.fn(async () => ({
			data: { user: { id: 'user-1' }, session: {} },
			error: null
		}));
		const accessRows = [
			{
				profile_id: 'user-1',
				membership_status: null,
				onboarding_completed_at: null,
				has_current_consents: false,
				is_active: false
			},
			{
				profile_id: 'user-1',
				membership_status: 'pending',
				onboarding_completed_at: null,
				has_current_consents: false,
				is_active: false
			}
		];
		const rpc = vi.fn(async (name: string) => {
			if (name === 'get_my_beta_access') {
				return { data: [accessRows.shift()], error: null };
			}
			if (name === 'claim_open_registration') return { data: true, error: null };
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
		).rejects.toMatchObject({ status: 303, location: '/onboarding?next=%2Fmessages' });
		expect(rpc.mock.calls.map(([name]) => name)).toEqual([
			'get_my_beta_access',
			'claim_open_registration',
			'get_my_beta_access'
		]);
	});

	it.each(['returned error', 'false result', 'thrown error'])(
		'fails closed and clears only current-project cookies when a missing-membership claim has a %s',
		async (failureMode) => {
			const signInWithPassword = vi.fn(async () => ({
				data: { user: { id: 'user-1' }, session: { access_token: 'private-session' } },
				error: null
			}));
			const signOut = vi.fn(async () => ({ error: new Error('provider sign-out failed') }));
			const rpc = vi.fn(async (name: string) => {
				if (name === 'get_my_beta_access') {
					return {
						data: [{
							profile_id: 'user-1',
							membership_status: null,
							onboarding_completed_at: null,
							has_current_consents: false,
							is_active: false
						}],
						error: null
					};
				}
				if (name !== 'claim_open_registration') throw new Error(`Unexpected RPC: ${name}`);
				if (failureMode === 'thrown error') throw new Error('private database transport detail');
				if (failureMode === 'false result') return { data: false, error: null };
				return { data: null, error: new Error('private database detail') };
			});
			const stored = new Map([
				['sb-market-auth-token.0', 'session-chunk-0'],
				['sb-market-auth-token.1', 'session-chunk-1'],
				['sb-foreign-auth-token', 'foreign-session']
			]);
			const cookies = {
				getAll: () => Array.from(stored, ([name, value]) => ({ name, value })),
				delete: vi.fn((_name: string) => {
					throw new Error('cookie delete adapter failed');
				}),
				set: vi.fn((name: string, value: string, options: { maxAge?: number; path?: string }) => {
					if (value === '' && options.maxAge === 0) stored.delete(name);
				})
			};
			const supabase = {
				auth: {
					signInWithPassword,
					signOut,
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

			const result = await actions.login(
				actionEvent('/login?/login', loginForm(), supabase, vi.fn(), cookies)
			);

			expect(result).toMatchObject({
				status: 503,
				data: { success: false, message: 'Входът временно не е достъпен.' }
			});
			expect(signOut).toHaveBeenCalledOnce();
			expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual([
				'sb-market-auth-token.0',
				'sb-market-auth-token.1'
			]);
			expect(cookies.getAll().map(({ name }) => name)).toEqual(['sb-foreign-auth-token']);
			expect(rpc.mock.calls.map(([name]) => name)).toEqual([
				'get_my_beta_access',
				'claim_open_registration'
			]);
			expect(JSON.stringify(result)).not.toContain('private');
		}
	);

	it.each(['pending', 'suspended', 'revoked'])(
		'does not claim open registration for an existing %s membership',
		async (membershipStatus) => {
			const rpc = vi.fn(async (name: string) => {
				if (name !== 'get_my_beta_access') throw new Error(`Unexpected RPC: ${name}`);
				return {
					data: [{
						profile_id: 'user-1',
						membership_status: membershipStatus,
						onboarding_completed_at: null,
						has_current_consents: false,
						is_active: false
					}],
					error: null
				};
			});
			const supabase = {
				auth: {
					signInWithPassword: vi.fn(async () => ({
						data: { user: { id: 'user-1' }, session: {} },
						error: null
					})),
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
			).rejects.toMatchObject({ status: 303, location: '/onboarding?next=%2Fmessages' });
			expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_my_beta_access']);
		}
	);

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

	it.each(['returned error', 'thrown error'])(
		'expires every current-project auth cookie and fails closed when signOut has a %s',
		async (failureMode) => {
			const signUp = vi.fn(async () => ({
				data: { user: { id: 'new-user' }, session: { access_token: 'unexpected' } },
				error: null
			}));
			const signOut = vi.fn(async () => {
				if (failureMode === 'thrown error') throw new Error('sign-out transport failed');
				return { error: new Error('sign-out provider failed') };
			});
			const rpc = vi.fn();
			const stored = new Map([
				['sb-market-auth-token.0', 'session-chunk-0'],
				['sb-market-auth-token.1', 'session-chunk-1'],
				['sb-foreign-auth-token', 'foreign-session']
			]);
			const cookies = {
				getAll: () => Array.from(stored, ([name, value]) => ({ name, value })),
				delete: vi.fn((_name: string) => {
					throw new Error('cookie delete adapter failed');
				}),
				set: vi.fn((name: string, value: string, options: { maxAge?: number; path?: string }) => {
					if (value === '' && options.maxAge === 0) stored.delete(name);
				})
			};

			const result = await actions.register(
				actionEvent(
					'/login?/register',
					registrationForm(),
					{ auth: { signUp, signOut }, rpc },
					vi.fn(),
					cookies
				)
			);

			expect(result).toMatchObject({ status: 503, data: { success: false } });
			expect(signOut).toHaveBeenCalledOnce();
			expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual([
				'sb-market-auth-token.0',
				'sb-market-auth-token.1'
			]);
			expect(
				cookies.set.mock.calls.map(([name, value, options]) => ({
					name,
					value,
					maxAge: options.maxAge,
					path: options.path
				}))
			).toEqual([
				{ name: 'sb-market-auth-token.0', value: '', maxAge: 0, path: '/' },
				{ name: 'sb-market-auth-token.1', value: '', maxAge: 0, path: '/' }
			]);
			expect(cookies.getAll().map(({ name }) => name)).toEqual(['sb-foreign-auth-token']);
			expect(rpc).not.toHaveBeenCalled();
			expect(JSON.stringify(result)).not.toContain('unexpected');
		}
	);
});
