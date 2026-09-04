import type { RequestHandler } from './$types';

const REDIRECT_HEADERS = {
	'cache-control': 'private, no-store',
	'referrer-policy': 'no-referrer'
} as const;

function confirmationRedirect(location: '/dashboard' | '/onboarding' | '/auth/error'): Response {
	return new Response(null, {
		status: 303,
		headers: { ...REDIRECT_HEADERS, location }
	});
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (locals.runtime.mode === 'demo') return confirmationRedirect('/dashboard');
	if (!locals.supabase) return confirmationRedirect('/auth/error');
	const supabase = locals.supabase;
	const signOutSafely = async () => {
		try {
			await supabase.auth.signOut();
		} catch {
			// The clean, non-cacheable error redirect must survive a provider sign-out failure.
		}
	};

	const rawTokenHash = url.searchParams.get('token_hash');
	const tokenHash = rawTokenHash?.trim();
	if (!tokenHash || url.searchParams.get('type') !== 'email') {
		return confirmationRedirect('/auth/error');
	}

	let verification: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
	try {
		verification = await supabase.auth.verifyOtp({
			token_hash: tokenHash,
			type: 'email'
		});
	} catch {
		return confirmationRedirect('/auth/error');
	}

	if (verification.error) {
		if (verification.data?.session) await signOutSafely();
		return confirmationRedirect('/auth/error');
	}

	const verifiedUser = verification.data?.user;
	if (!verifiedUser?.email_confirmed_at) {
		await signOutSafely();
		return confirmationRedirect('/auth/error');
	}

	try {
		const { data: claimed, error: claimError } = await supabase.rpc(
			'claim_open_registration'
		);
		if (claimError || claimed !== true) {
			await signOutSafely();
			return confirmationRedirect('/auth/error');
		}
	} catch {
		await signOutSafely();
		return confirmationRedirect('/auth/error');
	}

	return confirmationRedirect('/onboarding');
};

