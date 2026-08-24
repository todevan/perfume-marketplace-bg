import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAuthenticated, requiresConsentRenewal } from '$lib/server/auth/guards';
import { safeRedirectPath } from '$lib/server/auth/redirect';

const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,40}$/u;

interface LegalDocument {
	documentCode: string;
	currentVersion: string;
}

async function requiredLegalDocuments(locals: App.Locals): Promise<LegalDocument[]> {
	if (!locals.supabase) error(503, 'Условията за beta достъп временно не могат да бъдат заредени.');
	const { data, error: queryError } = await locals.supabase
		.from('beta_legal_documents')
		.select('document_code, document_version')
		.eq('required_for_access', true)
		.order('document_code');
	if (queryError) error(503, 'Условията за beta достъп временно не могат да бъдат заредени.');
	if (!data || data.length === 0) {
		error(503, 'Задължителните условия за beta достъп не са конфигурирани.');
	}

	return (data ?? []).map((row) => ({
		documentCode: String(row.document_code),
		currentVersion: String(row.document_version)
	}));
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
	if (locals.runtime.mode === 'demo') {
		return { mode: 'onboarding' as const, next, documents: [], profile: null };
	}

	requireAuthenticated(locals, url);
	if (locals.profile?.isSuspended || locals.betaAccess?.status === 'suspended') {
		error(403, 'Този профил е временно спрян.');
	}
	if (!locals.profile || !locals.betaAccess || locals.betaAccess.status === 'revoked') {
		error(403, 'За този профил няма валидна beta покана.');
	}
	if (locals.betaAccess.status === 'expired') {
		error(403, 'Достъпът до затворената beta е изтекъл.');
	}
	if (
		locals.betaAccess.status === 'active' &&
		locals.betaAccess.onboardingCompletedAt &&
		!locals.profile.emailVerifiedAt
	) {
		error(403, 'Имейл адресът трябва да бъде потвърден.');
	}
	const mode = requiresConsentRenewal(locals.profile, locals.betaAccess)
		? 'reconsent'
		: 'onboarding';
	if (mode !== 'reconsent' && locals.betaAccess.isActive) redirect(303, next);
	if (
		mode === 'onboarding' &&
		locals.betaAccess.status === 'active' &&
		locals.betaAccess.onboardingCompletedAt
	) {
		error(403, 'Нямате активен достъп до затворената beta.');
	}

	return {
		mode,
		next,
		documents: await requiredLegalDocuments(locals),
		profile: { username: locals.profile.username, city: locals.profile.city }
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const next = safeRedirectPath(formData.get('next')?.toString(), '/dashboard');
		if (locals.runtime.mode === 'demo') redirect(303, next);

		requireAuthenticated(locals, url);
		if (!locals.supabase || !locals.profile || !locals.betaAccess) {
			return fail(403, { success: false, message: 'Няма валидна покана за този профил.' });
		}
		if (
			locals.profile.isSuspended ||
			locals.betaAccess.status === 'suspended' ||
			locals.betaAccess.status === 'revoked'
		) {
			return fail(403, {
				success: false,
				message: 'Този профил няма право да променя onboarding данни.'
			});
		}
		if (locals.betaAccess.status === 'expired') {
			return fail(403, {
				success: false,
				message: 'Достъпът до затворената beta е изтекъл.'
			});
		}

		if (
			locals.betaAccess.status === 'active' &&
			locals.betaAccess.onboardingCompletedAt &&
			!locals.profile.emailVerifiedAt
		) {
			return fail(403, {
				success: false,
				message: 'Имейл адресът трябва да бъде потвърден.'
			});
		}

		const reconsent = requiresConsentRenewal(locals.profile, locals.betaAccess);
		if (
			!reconsent &&
			locals.betaAccess.status === 'active' &&
			locals.betaAccess.onboardingCompletedAt &&
			!locals.betaAccess.isActive
		) {
			return fail(403, {
				success: false,
				message: 'Този профил няма право да променя onboarding данни.'
			});
		}

		const username = reconsent ? '' : (formData.get('username')?.toString().trim() ?? '');
		const cityValue = reconsent ? '' : (formData.get('city')?.toString().trim() ?? '');
		const city = cityValue || null;

		if (!reconsent) {
			if (!USERNAME_PATTERN.test(username)) {
				return fail(400, {
					success: false,
					username,
					city: cityValue,
					message: 'Потребителското име трябва да е 3–40 букви, цифри, точки, тирета или долни черти.'
				});
			}
			if (cityValue.length === 1 || cityValue.length > 100) {
				return fail(400, {
					success: false,
					username,
					city: cityValue,
					message: 'Градът трябва да е между 2 и 100 знака.'
				});
			}
		}

		const documents = await requiredLegalDocuments(locals);
		if (documents.some((document) => formData.get(`consent_${document.documentCode}`) !== 'on')) {
			return fail(400, {
				success: false,
				username,
				city: cityValue,
				message: 'Потвърди всички задължителни документи.'
			});
		}

		for (const document of documents) {
			const { error: consentError } = await locals.supabase.rpc('accept_beta_consent', {
				requested_document_code: document.documentCode,
				requested_document_version: document.currentVersion
			});
			if (consentError) {
				return fail(503, {
					success: false,
					username,
					city: cityValue,
					message: 'Съгласието не можа да бъде записано. Опитай отново.'
				});
			}
		}

		if (reconsent) redirect(303, next);

		const { error: onboardingError } = await locals.supabase.rpc('complete_beta_onboarding', {
			desired_username: username,
			home_city: city
		});
		if (onboardingError) {
			return fail(400, {
				success: false,
				username,
				city: cityValue,
				message: onboardingError.code === '23505'
					? 'Това потребителско име вече е заето.'
					: 'Профилът не можа да бъде завършен.'
			});
		}

		redirect(303, next);
	}
};
