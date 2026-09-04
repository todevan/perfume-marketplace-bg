import type { RequestHandler } from './$types';
import { expireCurrentProjectAuthCookies } from '$lib/server/auth/cookies';

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

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	if (locals.runtime.mode === 'demo') return confirmationRedirect('/dashboard');
	if (!locals.supabase) return confirmationRedirect('/auth/error');
	const supabase = locals.supabase;
	const publicSupabaseUrl = locals.runtime.publicSupabaseUrl;
	const rejectAuthenticatedSession = async () => {
		try {
			await supabase.auth.signOut();
		} catch {
			// Exact-project cookie invalidation remains mandatory when provider cleanup fails.
		}
		await expireCurrentProjectAuthCookies(cookies, publicSupabaseUrl);
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
		await rejectAuthenticatedSession();
		return confirmationRedirect('/auth/error');
	}

	if (verification.error) {
		if (verification.data?.session) await rejectAuthenticatedSession();
		return confirmationRedirect('/auth/error');
	}

	const verifiedUser = verification.data?.user;
	if (!verifiedUser?.email_confirmed_at) {
		if (verification.data?.session) await rejectAuthenticatedSession();
		return confirmationRedirect('/auth/error');
	}

	let claimResult: Awaited<ReturnType<typeof supabase.rpc>>;
	try {
		claimResult = await supabase.rpc('claim_open_registration');
	} catch {
		await rejectAuthenticatedSession();
		return confirmationRedirect('/auth/error');
	}
	if (claimResult.error || claimResult.data !== true) {
		await rejectAuthenticatedSession();
		return confirmationRedirect('/auth/error');
	}

	return confirmationRedirect('/onboarding');
};

