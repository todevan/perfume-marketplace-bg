import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loadRequestAuthContext } from '$lib/server/auth/context';
import { safeRedirectPath } from '$lib/server/auth/redirect';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';
import { attestHostedBackendBaseline } from '$lib/server/services/backend-health';
import {
	InvalidFormDataError,
	parseBoundedFormData,
	RequestBodyTooLargeError,
	STANDARD_ACTION_FORM
} from '$lib/server/http/request-body';

const DEMO_EMAIL = 'demo@example.bg';
const DEMO_PASSWORD = 'demo-beta';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,40}$/u;

export const load: PageServerLoad = async ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
	if (
		locals.runtime.mode === 'production' &&
		locals.runtime.appEnvironment === 'staging'
	) {
		try {
			await attestHostedBackendBaseline({
				publicSupabaseUrl: locals.runtime.publicSupabaseUrl,
				supabaseSecretKey: locals.runtime.supabaseSecretKey
			});
		} catch {
			error(503, 'Входът временно не е достъпен.');
		}
	}

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
		const { error: admissionError } = await supabase.rpc('claim_open_registration');
		if (admissionError) {
			await supabase.auth.signOut();
			return fail(503, {
				success: false,
				email,
				message: 'Профилът временно не може да бъде активиран. Опитай отново по-късно.'
			});
		}

		const context = await loadRequestAuthContext(supabase);
		if (!context.betaAccess?.isActive) {
			redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
		}
		redirect(303, next);
	},

	register: async (event) => {
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
		const password = formData.get('password')?.toString() ?? '';
		const username = formData.get('username')?.toString().trim() ?? '';
		const accountKind = formData.get('kind') === 'merchant' ? 'merchant' : 'private';
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');

		if (event.locals.runtime.mode === 'demo') {
			redirect(303, next);
		}

		if (
			!EMAIL_PATTERN.test(email) ||
			!USERNAME_PATTERN.test(username) ||
			password.length < 12 ||
			password.length > 128 ||
			formData.get('ageAccepted') !== 'on'
		) {
			return fail(400, {
				success: false,
				email,
				message: 'Провери имейла, потребителското име, паролата и потвърждението за възраст.'
			});
		}

		const challenge = await verifyTurnstileForAction(
			event,
			formData,
			event.locals.runtime,
			'register'
		);
		if (!challenge.success) {
			return fail(challenge.reason === 'not_configured' ? 503 : 400, {
				success: false,
				email,
				message:
					challenge.reason === 'not_configured'
						? '\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f\u0442\u0430 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435 \u0435 \u0434\u043e\u0441\u0442\u044a\u043f\u043d\u0430.'
						: '\u041f\u043e\u0442\u0432\u044a\u0440\u0434\u0438, \u0447\u0435 \u043d\u0435 \u0441\u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0438\u0440\u0430\u043d \u043a\u043b\u0438\u0435\u043d\u0442.'
			});
		}

		const supabase = event.locals.supabase;
		if (!supabase) {
			return fail(503, { success: false, email, message: 'Регистрацията временно не е достъпна.' });
		}

		const confirmationUrl = new URL(
			'/auth/confirm',
			event.locals.runtime.publicAppUrl ?? event.url.origin
		);
		confirmationUrl.searchParams.set('next', `/onboarding?next=${encodeURIComponent(next)}`);
		const { data, error: signUpError } = await supabase.auth.signUp({
			email,
			password,
			options: {
				emailRedirectTo: confirmationUrl.toString(),
				data: { username, account_kind: accountKind }
			}
		});
		if (signUpError) {
			return fail(400, {
				success: false,
				email,
				message: 'Профилът не можа да бъде създаден. Провери данните или опитай по-късно.'
			});
		}
		if (data.session) {
			const { error: admissionError } = await supabase.rpc('claim_open_registration');
			if (admissionError) {
				await supabase.auth.signOut();
				return fail(503, {
					success: false,
					email,
					message: 'Профилът временно не може да бъде активиран. Опитай отново по-късно.'
				});
			}
			redirect(303, `/onboarding?next=${encodeURIComponent(next)}`);
		}

		return {
			success: true,
			email,
			message: 'Провери имейла си и потвърди регистрацията, за да завършиш профила.'
		};
	}
};
