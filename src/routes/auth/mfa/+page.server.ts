import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireRole } from '$lib/server/auth/guards';
import { safeRedirectPath } from '$lib/server/auth/redirect';

async function verifiedTotpFactors(locals: App.Locals) {
	if (!locals.supabase) return [];
	const { data, error } = await locals.supabase.auth.mfa.listFactors();
	if (error) return [];
	return data.totp.filter((factor) => factor.status === 'verified');
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/admin');
	if (locals.runtime.mode === 'demo') redirect(303, next);
	requireRole(locals, url, ['moderator', 'admin']);
	if (locals.currentAal === 'aal2') redirect(303, next);

	const factors = await verifiedTotpFactors(locals);
	return {
		next,
		factors: factors.map(({ id, friendly_name }) => ({ id, friendlyName: friendly_name ?? 'Authenticator' }))
	};
};

export const actions: Actions = {
	enroll: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/admin');
		if (locals.runtime.mode === 'demo') redirect(303, '/admin');
		requireRole(locals, url, ['moderator', 'admin']);
		if (!locals.supabase) return fail(503, { success: false, message: 'MFA временно не е достъпно.' });

		const { data, error } = await locals.supabase.auth.mfa.enroll({
			factorType: 'totp',
			friendlyName: 'Perfume marketplace staff'
		});
		if (error) return fail(400, { success: false, message: 'MFA факторът не можа да бъде създаден.' });
		return {
			success: true,
			mode: 'enrollment',
			factorId: data.id,
			qrCode: data.totp.qr_code,
			secret: data.totp.secret,
			next,
			message: 'Сканирай кода и въведи първия шестцифрен код.'
		};
	},

	verify: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/admin');
		const factorId = formData.get('factorId')?.toString() ?? '';
		const code = formData.get('code')?.toString().trim() ?? '';
		if (!/^\d{6}$/.test(code)) {
			return fail(400, { success: false, mode: 'verification', factorId, next, message: 'Въведи шестцифрен код.' });
		}
		if (locals.runtime.mode === 'demo') redirect(303, next);
		requireRole(locals, url, ['moderator', 'admin']);
		if (!locals.supabase) return fail(503, { success: false, message: 'MFA временно не е достъпно.' });

		const factors = await verifiedTotpFactors(locals);
		if (!factors.some((factor) => factor.id === factorId)) {
			return fail(400, { success: false, mode: 'verification', factorId, next, message: 'Невалиден MFA фактор.' });
		}
		const { error } = await locals.supabase.auth.mfa.challengeAndVerify({ factorId, code });
		if (error) return fail(400, { success: false, mode: 'verification', factorId, next, message: 'Кодът е невалиден или е изтекъл.' });
		redirect(303, next);
	},

	verifyEnrollment: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/admin');
		const factorId = formData.get('factorId')?.toString() ?? '';
		const code = formData.get('code')?.toString().trim() ?? '';
		if (!factorId || !/^\d{6}$/.test(code)) {
			return fail(400, { success: false, mode: 'enrollment', factorId, next, message: 'Въведи шестцифрен код.' });
		}
		if (locals.runtime.mode === 'demo') redirect(303, next);
		requireRole(locals, url, ['moderator', 'admin']);
		if (!locals.supabase) return fail(503, { success: false, message: 'MFA временно не е достъпно.' });

		const { error } = await locals.supabase.auth.mfa.challengeAndVerify({ factorId, code });
		if (error) return fail(400, { success: false, mode: 'enrollment', factorId, next, message: 'Кодът е невалиден или е изтекъл.' });
		redirect(303, next);
	}
};
