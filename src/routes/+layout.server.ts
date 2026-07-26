import type { LayoutServerLoad } from './$types';
import { toPublicAuthState } from '$lib/server/auth/types';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		auth: toPublicAuthState(locals),
		demoMode: locals.runtime.mode === 'demo',
		authConfigured: locals.runtime.mode === 'production',
		turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
		requestId: locals.requestId
	};
};

