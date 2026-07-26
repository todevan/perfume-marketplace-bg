import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { safeRedirectPath } from '$lib/server/auth/redirect';

export const load: PageServerLoad = ({ url, locals }) => {
	if (locals.runtime.mode === 'production' && !locals.user) {
		redirect(303, '/login');
	}
	return { next: safeRedirectPath(url.searchParams.get('next'), '/dashboard') };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = await request.formData();
		const password = formData.get('password')?.toString() ?? '';
		const confirmation = formData.get('passwordConfirmation')?.toString() ?? '';
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');

		if (password.length < 12 || password.length > 128) {
			return fail(400, { success: false, message: 'Паролата трябва да е между 12 и 128 знака.' });
		}
		if (password !== confirmation) {
			return fail(400, { success: false, message: 'Двете пароли не съвпадат.' });
		}
		if (locals.runtime.mode === 'demo') redirect(303, next);
		if (!locals.user || !locals.supabase) {
			return fail(401, { success: false, message: 'Връзката за възстановяване е изтекла.' });
		}

		const { error } = await locals.supabase.auth.updateUser({ password });
		if (error) return fail(400, { success: false, message: 'Паролата не можа да бъде променена.' });
		await locals.supabase.auth.signOut({ scope: 'others' });

		if (!locals.betaAccess?.isActive) {
			redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
		}
		redirect(303, next);
	}
};

