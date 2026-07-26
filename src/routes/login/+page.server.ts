import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loadRequestAuthContext } from '$lib/server/auth/context';
import { safeRedirectPath } from '$lib/server/auth/redirect';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';

const DEMO_EMAIL = 'demo@example.bg';
const DEMO_PASSWORD = 'demo-beta';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const load: PageServerLoad = ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
	if (locals.runtime.mode === 'production' && locals.user) {
		if (locals.betaAccess?.isActive) redirect(303, next);
		redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
	}

	return {
		next,
		demoMode: locals.runtime.mode === 'demo',
		turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
		demoEmail: locals.runtime.mode === 'demo' ? DEMO_EMAIL : ''
	};
};

export const actions: Actions = {
	login: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');

		if (!EMAIL_PATTERN.test(email) || password.length < 8 || password.length > 128) {
			return fail(400, { success: false, email, message: 'Провери имейла и паролата.' });
		}

		if (event.locals.runtime.mode === 'demo') {
			if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
				return fail(400, { success: false, email, message: 'Невалидни демо данни.' });
			}
			redirect(303, next);
		}

		const challenge = await verifyTurnstileForAction(
			event,
			formData,
			event.locals.runtime,
			'login'
		);
		if (!challenge.success) {
			return fail(challenge.reason === 'not_configured' ? 503 : 400, {
				success: false,
				email,
				message:
					challenge.reason === 'not_configured'
						? 'Входът временно не е достъпен.'
						: 'Потвърди, че не си автоматизиран клиент.'
			});
		}

		const supabase = event.locals.supabase;
		if (!supabase) return fail(503, { success: false, email, message: 'Входът временно не е достъпен.' });

		const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
		if (signInError) {
			return fail(400, { success: false, email, message: 'Невалиден имейл или парола.' });
		}

		const context = await loadRequestAuthContext(supabase);
		if (!context.betaAccess?.isActive) {
			redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
		}
		redirect(303, next);
	},

	register: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase() ?? '';
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');

		if (event.locals.runtime.mode === 'demo') {
			redirect(303, next);
		}

		return fail(403, {
			success: false,
			email,
			message: 'Регистрацията е само с покана. Използвай връзката от поканата си.'
		});
	}
};

