import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loadRequestAuthContext } from '$lib/server/auth/context';
import { safeRedirectPath } from '$lib/server/auth/redirect';
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
const MAX_CAPTCHA_TOKEN_LENGTH = 2048;

function readCaptchaToken(formData: FormData): string | null {
	const values = formData.getAll('cf-turnstile-response');
	if (values.length !== 1 || typeof values[0] !== 'string') return null;
	const token = values[0];
	if (!token.trim() || token.length > MAX_CAPTCHA_TOKEN_LENGTH) return null;
	return token;
}

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

		const captchaToken = readCaptchaToken(formData);
		if (!captchaToken) {
			return fail(400, {
				success: false,
				email,
				message: 'Потвърди, че не си автоматизиран клиент.'
			});
		}

		const supabase = event.locals.supabase;
		if (!supabase) return fail(503, { success: false, email, message: 'Входът временно не е достъпен.' });

		const { error: signInError } = await supabase.auth.signInWithPassword({
			email,
			password,
			options: { captchaToken }
		});
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

		const captchaToken = readCaptchaToken(formData);
		if (!captchaToken) {
			return fail(400, {
				success: false,
				email,
				message: 'Потвърди, че не си автоматизиран клиент.'
			});
		}

		const supabase = event.locals.supabase;
		if (!supabase) {
			return fail(503, { success: false, email, message: 'Регистрацията временно не е достъпна.' });
		}

		const { data, error: signUpError } = await supabase.auth.signUp({
			email,
			password,
			options: {
				captchaToken,
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
			try {
				await supabase.auth.signOut();
			} catch {
				// Preserve the generic fail-closed response even if session cleanup cannot be confirmed.
			}
			return fail(503, {
				success: false,
				email,
				message: 'Регистрацията временно не е достъпна.'
			});
		}

		return {
			success: true,
			email,
			message: 'Провери имейла си и потвърди регистрацията, за да завършиш профила.'
		};
	}
};
