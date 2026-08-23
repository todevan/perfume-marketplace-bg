import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { safeRedirectPath } from '$lib/server/auth/redirect';

const ALLOWED_TYPES = new Set<EmailOtpType>([
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email_change',
	'email'
]);

export const GET: RequestHandler = async ({ url, locals }) => {
	if (locals.runtime.mode === 'demo') redirect(303, '/dashboard');
	if (!locals.supabase) redirect(303, '/auth/error?reason=not_configured');

	const tokenHash = url.searchParams.get('token_hash');
	const rawType = url.searchParams.get('type');
	if (!tokenHash || !rawType || !ALLOWED_TYPES.has(rawType as EmailOtpType)) {
		redirect(303, '/auth/error?reason=invalid_link');
	}

	const type = rawType as EmailOtpType;
	const { error: verificationError } = await locals.supabase.auth.verifyOtp({
		token_hash: tokenHash,
		type
	});
	if (verificationError) redirect(303, '/auth/error?reason=invalid_or_expired');

	if (type === 'invite') {
		const inviteToken = url.searchParams.get('invite_token');
		if (!inviteToken) {
			await locals.supabase.auth.signOut();
			redirect(303, '/auth/error?reason=missing_beta_invite');
		}

		const { error: inviteError } = await locals.supabase.rpc('redeem_beta_invite', {
			invite_token: inviteToken
		});
		if (inviteError) {
			await locals.supabase.auth.signOut();
			redirect(303, '/auth/error?reason=invalid_beta_invite');
		}

		const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
		redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
	}

	if (type === 'recovery') redirect(303, '/auth/update-password');
	if (type === 'signup' || type === 'email') {
		const { error: admissionError } = await locals.supabase.rpc('claim_open_registration');
		if (admissionError) {
			await locals.supabase.auth.signOut();
			redirect(303, '/auth/error?reason=profile_activation_failed');
		}
	}
	redirect(303, safeRedirectPath(url.searchParams.get('next'), '/dashboard'));
};

