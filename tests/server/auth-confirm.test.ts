import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/auth/confirm/+server';

function confirmationEvent({
	verifyError = null,
	claimError = null,
	next = '/onboarding?next=%2Fdashboard'
}: {
	verifyError?: Error | null;
	claimError?: Error | null;
	next?: string;
} = {}) {
	const verifyOtp = vi.fn(async () => ({ data: { session: null, user: null }, error: verifyError }));
	const rpc = vi.fn(async () => ({ data: claimError ? null : true, error: claimError }));
	const signOut = vi.fn(async () => ({ error: null }));
	const url = new URL('https://market.example/auth/confirm');
	url.searchParams.set('token_hash', 'signup-token-hash');
	url.searchParams.set('type', 'signup');
	url.searchParams.set('next', next);

	return {
		event: {
			url,
			locals: {
				runtime: { mode: 'production' },
				supabase: { auth: { verifyOtp, signOut }, rpc }
			}
		} as never,
		verifyOtp,
		rpc,
		signOut
	};
}

describe('signup confirmation handler', () => {
	it('verifies the signup token, claims pending membership, and follows the safe onboarding redirect', async () => {
		const { event, verifyOtp, rpc, signOut } = confirmationEvent();

		await expect(GET(event)).rejects.toMatchObject({
			status: 303,
			location: '/onboarding?next=%2Fdashboard'
		});
		expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
			token_hash: 'signup-token-hash',
			type: 'signup'
		});
		expect(rpc).toHaveBeenCalledExactlyOnceWith('claim_open_registration');
		expect(signOut).not.toHaveBeenCalled();
	});

	it('rejects an invalid or expired token without claiming marketplace membership', async () => {
		const { event, rpc } = confirmationEvent({ verifyError: new Error('expired') });

		await expect(GET(event)).rejects.toMatchObject({
			status: 303,
			location: '/auth/error?reason=invalid_or_expired'
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it('signs out and fails closed when pending membership cannot be claimed', async () => {
		const { event, signOut } = confirmationEvent({ claimError: new Error('database unavailable') });

		await expect(GET(event)).rejects.toMatchObject({
			status: 303,
			location: '/auth/error?reason=profile_activation_failed'
		});
		expect(signOut).toHaveBeenCalledOnce();
	});

	it('does not follow an external post-confirmation redirect', async () => {
		const { event } = confirmationEvent({ next: 'https://attacker.example/steal' });

		await expect(GET(event)).rejects.toMatchObject({ status: 303, location: '/dashboard' });
	});
});
