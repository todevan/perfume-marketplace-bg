import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	InvalidFormDataError,
	parseBoundedFormData,
	RequestBodyTooLargeError,
	STANDARD_ACTION_FORM
} from '$lib/server/http/request-body';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const load: PageServerLoad = ({ locals }) => ({
	turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
	demoMode: locals.runtime.mode === 'demo'
});

export const actions: Actions = {
	default: async (event) => {
		let formData: FormData;
		try {
			formData = await parseBoundedFormData(event.request, STANDARD_ACTION_FORM);
		} catch (cause) {
			if (cause instanceof RequestBodyTooLargeError) {
				return fail(413, { success: false, email: '', message: 'Заявката е твърде голяма.' });
			}
			if (cause instanceof InvalidFormDataError) {
				return fail(400, { success: false, email: '', message: 'Изпрати валидни данни от формата.' });
			}
			throw cause;
		}
		const email = formData.get('email')?.toString().trim().toLowerCase() ?? '';
		if (!EMAIL_PATTERN.test(email)) {
			return fail(400, { success: false, email, message: 'Въведи валиден имейл.' });
		}

		// Demo deliberately performs no network request and never simulates a recoverable account.
		if (event.locals.runtime.mode === 'demo') {
			return { success: true, message: 'Демо режимът не изпраща имейли.' };
		}

		const captchaToken = formData.get('cf-turnstile-response')?.toString().trim() ?? '';
		if (!captchaToken) {
			return fail(400, {
				success: false,
				email,
				message: 'Потвърди, че не си автоматизиран клиент.'
			});
		}

		if (!event.locals.supabase) {
			return fail(503, { success: false, email, message: 'Възстановяването временно не е достъпно.' });
		}

		const appOrigin = event.locals.runtime.publicAppUrl ?? event.url.origin;
		const callback = new URL('/auth/callback', appOrigin);
		callback.searchParams.set('next', '/auth/update-password');
		await event.locals.supabase.auth.resetPasswordForEmail(email, {
			redirectTo: callback.toString(),
			captchaToken
		});

		// Always return the same response so the endpoint cannot enumerate registered emails.
		return {
			success: true,
			message: 'Ако има профил с този имейл, ще получиш връзка за нова парола.'
		};
	}
};
