import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireBetaAccess } from '$lib/server/auth/guards';
import { safeRedirectPath } from '$lib/server/auth/redirect';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';

const E164_PATTERN = /^\+359\d{8,9}$/;
const OTP_PATTERN = /^\d{6}$/;

function maskPhone(phone: string | null | undefined): string | null {
	if (!phone) return null;
	return `${phone.slice(0, Math.min(4, phone.length))}••••${phone.slice(-3)}`;
}

export const load: PageServerLoad = ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
	if (locals.runtime.mode === 'demo') {
		return { next, currentPhone: null, turnstileSiteKey: null, demoMode: true };
	}

	const authorized = requireBetaAccess(locals, url);
	if (authorized.profile.phoneVerifiedAt && url.searchParams.get('change') !== '1') redirect(303, next);
	return {
		next,
		currentPhone: maskPhone(authorized.user.phone),
		turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
		demoMode: false
	};
};

export const actions: Actions = {
	requestOtp: async (event) => {
		const formData = await event.request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');
		const phone = formData.get('phone')?.toString().replace(/[\s()-]/g, '') ?? '';
		if (!E164_PATTERN.test(phone)) {
			return fail(400, { success: false, step: 'request', phone, message: 'Beta поддържа само български номер във формат +359…' });
		}
		if (event.locals.runtime.mode === 'demo') redirect(303, next);
		requireBetaAccess(event.locals, event.url);

		const challenge = await verifyTurnstileForAction(
			event,
			formData,
			event.locals.runtime,
			'phone_change'
		);
		if (!challenge.success) {
			return fail(challenge.reason === 'not_configured' ? 503 : 400, {
				success: false,
				step: 'request',
				phone,
				message:
					challenge.reason === 'not_configured'
						? 'Проверката на телефон временно не е достъпна.'
						: 'Потвърди, че не си автоматизиран клиент.'
			});
		}

		if (!event.locals.supabase) return fail(503, { success: false, step: 'request', phone, message: 'Услугата временно не е достъпна.' });
		const { error } = await event.locals.supabase.auth.updateUser({ phone });
		if (error) {
			return fail(400, { success: false, step: 'request', phone, message: 'Кодът не можа да бъде изпратен.' });
		}
		return { success: true, step: 'verify', phone, next, message: 'Изпратихме еднократен код.' };
	},

	verifyOtp: async (event) => {
		const formData = await event.request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');
		const phone = formData.get('phone')?.toString().replace(/[\s()-]/g, '') ?? '';
		const code = formData.get('code')?.toString().trim() ?? '';
		if (!E164_PATTERN.test(phone) || !OTP_PATTERN.test(code)) {
			return fail(400, { success: false, step: 'verify', phone, next, message: 'Въведи валиден шестцифрен код.' });
		}
		if (event.locals.runtime.mode === 'demo') redirect(303, next);
		requireBetaAccess(event.locals, event.url);
		if (!event.locals.supabase) return fail(503, { success: false, step: 'verify', phone, next, message: 'Услугата временно не е достъпна.' });

		const { error } = await event.locals.supabase.auth.verifyOtp({
			phone,
			token: code,
			type: 'phone_change'
		});
		if (error) {
			return fail(400, { success: false, step: 'verify', phone, next, message: 'Кодът е невалиден или е изтекъл.' });
		}
		redirect(303, next);
	},

	resendOtp: async (event) => {
		const formData = await event.request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');
		const phone = formData.get('phone')?.toString().replace(/[\s()-]/g, '') ?? '';
		if (!E164_PATTERN.test(phone)) {
			return fail(400, { success: false, step: 'verify', phone, next, message: 'Телефонът е невалиден.' });
		}
		if (event.locals.runtime.mode === 'demo') redirect(303, next);
		requireBetaAccess(event.locals, event.url);

		const challenge = await verifyTurnstileForAction(
			event,
			formData,
			event.locals.runtime,
			'phone_change'
		);
		if (!challenge.success) {
			return fail(challenge.reason === 'not_configured' ? 503 : 400, {
				success: false,
				step: 'verify',
				phone,
				next,
				message: challenge.reason === 'not_configured'
					? 'Проверката на телефон временно не е достъпна.'
					: 'Потвърди, че не си автоматизиран клиент.'
			});
		}

		if (!event.locals.supabase) return fail(503, { success: false, step: 'verify', phone, next, message: 'Услугата временно не е достъпна.' });
		const { error } = await event.locals.supabase.auth.resend({ type: 'phone_change', phone });
		if (error) {
			return fail(400, { success: false, step: 'verify', phone, next, message: 'Нов код не можа да бъде изпратен още.' });
		}
		return { success: true, step: 'verify', phone, next, message: 'Изпратихме нов еднократен код.' };
	}
};
