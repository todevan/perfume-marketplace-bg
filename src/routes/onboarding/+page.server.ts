import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAuthenticated } from '$lib/server/auth/guards';
import { safeRedirectPath } from '$lib/server/auth/redirect';
import { cityInputSchema } from '$lib/contracts/profiles';

const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,40}$/u;

interface LegalDocument {
	documentCode: string;
	currentVersion: string;
}

async function requiredLegalDocuments(locals: App.Locals): Promise<LegalDocument[]> {
	if (!locals.supabase) return [];
	const { data, error: queryError } = await locals.supabase
		.from('beta_legal_documents')
		.select('document_code, document_version')
		.eq('required_for_access', true)
		.order('document_code');
	if (queryError) error(503, 'Условията за beta достъп временно не могат да бъдат заредени.');

	return (data ?? []).map((row) => ({
		documentCode: String(row.document_code),
		currentVersion: String(row.document_version)
	}));
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');
	if (locals.runtime.mode === 'demo') return { next, documents: [], profile: null };

	requireAuthenticated(locals, url);
	if (locals.profile?.isSuspended || locals.betaAccess?.status === 'suspended') {
		error(403, 'Този профил е временно спрян.');
	}
	if (!locals.profile || !locals.betaAccess || locals.betaAccess.status === 'revoked') {
		error(403, 'За този профил няма валидна beta покана.');
	}
	if (locals.betaAccess.isActive) redirect(303, next);

	return {
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

		const username = formData.get('username')?.toString().trim() ?? '';
		const cityResult = cityInputSchema.safeParse(formData.get('city'));
		const cityValue = cityResult.success ? cityResult.data : '';

		if (!USERNAME_PATTERN.test(username)) {
			return fail(400, {
				success: false,
				username,
				city: cityValue,
				message: 'Потребителското име трябва да е 3–40 букви, цифри, точки, тирета или долни черти.'
			});
		}
		if (!cityResult.success) {
			return fail(400, { success: false, username, city: cityValue, message: 'Градът трябва да е между 2 и 100 знака.' });
		}

		const documents = await requiredLegalDocuments(locals);
		if (documents.length === 0) {
			return fail(503, {
				success: false,
				username,
				city: cityValue,
				message: 'Задължителните условия за beta достъп не са конфигурирани.'
			});
		}
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

		const { error: onboardingError } = await locals.supabase.rpc('complete_beta_onboarding', {
			desired_username: username,
			home_city: cityValue
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
