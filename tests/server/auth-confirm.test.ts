import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/auth/confirm/+server';

type ConfirmationOptions = {
	type: 'email' | 'signup';
	verificationError?: Error | null;
	claimError?: Error | null;
	next?: string;
};

function confirmationEvent({
	type,
	verificationError = null,
	claimError = null,
	next = '/onboarding'
}: ConfirmationOptions) {
	const verifyOtp = vi.fn(async () => ({ data: {}, error: verificationError }));
	const rpc = vi.fn(async () => ({ data: true, error: claimError }));
	const signOut = vi.fn(async () => ({ error: null }));
	const url = new URL('https://market.example/auth/confirm');
	url.searchParams.set('token_hash', 'confirmation-token-hash');
	url.searchParams.set('type', type);
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

describe('email confirmation admission boundary', () => {
	it.each(['signup', 'email'] as const)(
		'claims open registration after a valid %s confirmation',
		async (type) => {
			const { event, verifyOtp, rpc, signOut } = confirmationEvent({ type });

			await expect(GET(event)).rejects.toMatchObject({
				status: 303,
				location: '/onboarding'
			});
			expect(verifyOtp).toHaveBeenCalledOnce();
			expect(verifyOtp).toHaveBeenCalledWith({
				token_hash: 'confirmation-token-hash',
				type
			});
			expect(rpc).toHaveBeenCalledOnce();
			expect(rpc).toHaveBeenCalledWith('claim_open_registration');
			expect(signOut).not.toHaveBeenCalled();
		}
	);

	it('never claims registration when token verification fails', async () => {
		const { event, rpc, signOut } = confirmationEvent({
			type: 'email',
			verificationError: new Error('expired')
		});

		await expect(GET(event)).rejects.toMatchObject({
			status: 303,
			location: '/auth/error?reason=invalid_or_expired'
		});
		expect(rpc).not.toHaveBeenCalled();
		expect(signOut).not.toHaveBeenCalled();
	});

	it('signs out when open-registration claiming fails', async () => {
		const { event, rpc, signOut } = confirmationEvent({
			type: 'email',
			claimError: new Error('claim failed')
		});

		await expect(GET(event)).rejects.toMatchObject({
			status: 303,
			location: '/auth/error?reason=profile_activation_failed'
		});
		expect(rpc).toHaveBeenCalledWith('claim_open_registration');
		expect(signOut).toHaveBeenCalledOnce();
	});

	it('sanitizes an external next URL after successful confirmation', async () => {
		const { event } = confirmationEvent({
			type: 'email',
			next: 'https://attacker.example/collect'
		});

		await expect(GET(event)).rejects.toMatchObject({ status: 303, location: '/dashboard' });
	});
});
