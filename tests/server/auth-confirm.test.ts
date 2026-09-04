import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/auth/confirm/+server';

function confirmationEvent(
	query: string,
	supabase: unknown,
	mode: 'production' | 'demo' = 'production',
	cookies: unknown = { getAll: () => [], delete: vi.fn(), set: vi.fn() }
) {
	return {
		url: new URL(`https://market.example/auth/confirm${query}`),
		locals: {
			runtime: {
				mode,
				demoMode: mode === 'demo',
				appEnvironment: 'development',
				publicSupabaseUrl: 'https://market.supabase.co',
				imageProcessorMode: 'disabled'
			},
			supabase
		},
		cookies
	} as never;
}

function expectPrivateRedirect(response: Response, location: string): void {
	expect(response.status).toBe(303);
	expect(response.headers.get('location')).toBe(location);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}

function verifiedResult() {
	return {
		data: {
			user: { id: 'user-1', email_confirmed_at: '2026-09-01T10:00:00Z' },
			session: { access_token: 'private-session' }
		},
		error: null
	};
}

describe('email confirmation endpoint', () => {
	it('verifies the email token before claiming registration and redirects to clean onboarding', async () => {
		const order: string[] = [];
		const verifyOtp = vi.fn(async () => {
			order.push('verify');
			return verifiedResult();
		});
		const rpc = vi.fn(async () => {
			order.push('claim');
			return { data: true, error: null };
		});
		const signOut = vi.fn();

		const response = await GET(
			confirmationEvent('?token_hash=valid-hash&type=email&next=%2Fadmin', {
				auth: { verifyOtp, signOut },
				rpc
			})
		);

		expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: 'valid-hash', type: 'email' });
		expect(rpc).toHaveBeenCalledExactlyOnceWith('claim_open_registration');
		expect(order).toEqual(['verify', 'claim']);
		expect(signOut).not.toHaveBeenCalled();
		expectPrivateRedirect(response, '/onboarding');
	});

	it.each([
		['missing token', '?type=email'],
		['blank token', '?token_hash=%20%20%20&type=email'],
		['missing type', '?token_hash=hash'],
		['legacy signup type', '?token_hash=hash&type=signup'],
		['wrong case', '?token_hash=hash&type=Email']
	])('rejects %s without verification or claim', async (_, query) => {
		const verifyOtp = vi.fn();
		const rpc = vi.fn();
		const response = await GET(
			confirmationEvent(query, { auth: { verifyOtp, signOut: vi.fn() }, rpc })
		);

		expect(verifyOtp).not.toHaveBeenCalled();
		expect(rpc).not.toHaveBeenCalled();
		expectPrivateRedirect(response, '/auth/error');
	});

	it('does not claim a wrong or expired token', async () => {
		const verifyOtp = vi.fn(async () => ({ data: { user: null, session: null }, error: new Error('invalid') }));
		const signOut = vi.fn();
		const rpc = vi.fn();
		const response = await GET(
			confirmationEvent('?token_hash=wrong-hash&type=email', {
				auth: { verifyOtp, signOut },
				rpc
			})
		);

		expect(verifyOtp).toHaveBeenCalledOnce();
		expect(signOut).not.toHaveBeenCalled();
		expect(rpc).not.toHaveBeenCalled();
		expectPrivateRedirect(response, '/auth/error');
	});

	it('expires a possible session when verification throws after receiving the token', async () => {
		const verifyOtp = vi.fn(async () => {
			throw new Error('verification transport failed');
		});
		const signOut = vi.fn(async () => {
			throw new Error('sign-out transport failed');
		});
		const rpc = vi.fn();
		const stored = new Map([
			['sb-market-auth-token', 'possible-session'],
			['sb-foreign-auth-token', 'foreign-session']
		]);
		const cookies = {
			getAll: () => Array.from(stored, ([name, value]) => ({ name, value })),
			delete: vi.fn((name: string) => stored.delete(name)),
			set: vi.fn()
		};

		const response = await GET(
			confirmationEvent(
				'?token_hash=hash&type=email',
				{ auth: { verifyOtp, signOut }, rpc },
				'production',
				cookies
			)
		);

		expect(signOut).toHaveBeenCalledOnce();
		expect(cookies.delete).toHaveBeenCalledExactlyOnceWith('sb-market-auth-token', { path: '/' });
		expect(cookies.getAll().map(({ name }) => name)).toEqual(['sb-foreign-auth-token']);
		expect(rpc).not.toHaveBeenCalled();
		expectPrivateRedirect(response, '/auth/error');
	});

	it.each([
		['missing user', { user: null, session: { access_token: 'private-session' } }],
		['unverified user', { user: { id: 'user-1', email_confirmed_at: null }, session: { access_token: 'private-session' } }]
	])('signs out and refuses to claim after verification returns a %s', async (_, data) => {
		const verifyOtp = vi.fn(async () => ({ data, error: null }));
		const signOut = vi.fn(async () => ({ error: null }));
		const rpc = vi.fn();
		const response = await GET(
			confirmationEvent('?token_hash=hash&type=email', {
				auth: { verifyOtp, signOut },
				rpc
			})
		);

		expect(rpc).not.toHaveBeenCalled();
		expect(signOut).toHaveBeenCalledOnce();
		expectPrivateRedirect(response, '/auth/error');
	});

	it.each(['returned error', 'thrown error'])(
		'expires only current-project cookies and returns a clean error when claim cleanup has a %s',
		async (failureMode) => {
			const verifyOtp = vi.fn(async () => verifiedResult());
			const signOut = vi.fn(async () => {
				if (failureMode === 'thrown error') throw new Error('sign-out transport failed');
				return { error: new Error('sign-out provider failed') };
			});
			const rpc = vi.fn(async () => ({
				data: null,
				error: new Error('private database detail')
			}));
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
			const response = await GET(
				confirmationEvent(
					'?token_hash=hash&type=email',
					{ auth: { verifyOtp, signOut }, rpc },
					'production',
					cookies
				)
			);

			expect(signOut).toHaveBeenCalledOnce();
			expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual([
				'sb-market-auth-token.0',
				'sb-market-auth-token.1'
			]);
			expect(cookies.getAll().map(({ name }) => name)).toEqual(['sb-foreign-auth-token']);
			expectPrivateRedirect(response, '/auth/error');
			expect(await response.text()).toBe('');
		}
	);

	it('does not claim when the same single-use link is reused', async () => {
		const verifyOtp = vi
			.fn()
			.mockResolvedValueOnce(verifiedResult())
			.mockResolvedValueOnce({ data: { user: null, session: null }, error: new Error('used') });
		const rpc = vi.fn(async () => ({ data: true, error: null }));
		const supabase = { auth: { verifyOtp, signOut: vi.fn() }, rpc };

		const first = await GET(confirmationEvent('?token_hash=single-use&type=email', supabase));
		const second = await GET(confirmationEvent('?token_hash=single-use&type=email', supabase));

		expectPrivateRedirect(first, '/onboarding');
		expectPrivateRedirect(second, '/auth/error');
		expect(verifyOtp).toHaveBeenCalledTimes(2);
		expect(rpc).toHaveBeenCalledOnce();
	});

	it('uses the exact server-side confirmation link template', () => {
		const template = readFileSync('supabase/templates/confirmation.html', 'utf8').trim();
		const config = readFileSync('supabase/config.toml', 'utf8');

		expect(template).toBe(
			'<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm email</a>'
		);
		expect(config).toContain('[auth.email.template.confirmation]');
		expect(config).toContain('content_path = "./supabase/templates/confirmation.html"');
	});
});
