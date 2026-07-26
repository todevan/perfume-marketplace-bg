import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { safeRedirectPath } from '$lib/server/auth/redirect';

export const GET: RequestHandler = async ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
	if (locals.runtime.mode === 'demo') redirect(303, next);

	const code = url.searchParams.get('code');
	const inviteToken = url.searchParams.get('invite_token');
	if (!code || !locals.supabase) redirect(303, '/auth/error?reason=invalid_callback');

	const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (error) redirect(303, '/auth/error?reason=invalid_or_expired');

	if (inviteToken) {
		const { error: inviteError } = await locals.supabase.rpc('redeem_beta_invite', {
			invite_token: inviteToken
		});
		if (inviteError) {
			await locals.supabase.auth.signOut();
			redirect(303, '/auth/error?reason=invalid_beta_invite');
		}
		redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
	}

	redirect(303, next);
};
