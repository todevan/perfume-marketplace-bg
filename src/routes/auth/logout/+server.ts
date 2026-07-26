import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, locals }) => {
	if (request.headers.get('origin') !== url.origin) error(403, 'Invalid request origin.');
	if (locals.runtime.mode === 'production' && locals.supabase) {
		await locals.supabase.auth.signOut();
	}
	redirect(303, '/login');
};

export const GET: RequestHandler = () =>
	new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });

