import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireMfa, requireRole } from '$lib/server/auth/guards';
import type { PlatformRole, RequestAuthContext } from '$lib/server/auth/types';

export interface StaffRequestContext {
	client: SupabaseClient;
	actor: {
		id: string;
		username: string;
		role: 'moderator' | 'admin';
	};
}

function authContext(locals: App.Locals): RequestAuthContext {
	return {
		user: locals.user,
		profile: locals.profile,
		betaAccess: locals.betaAccess,
		currentAal: locals.currentAal,
		nextAal: locals.nextAal
	};
}

/**
 * Re-checks the route security at the mutation boundary. The global hook applies
 * the same policy, but actions deliberately fail closed when invoked in isolation.
 */
export function requireStaffRequest(
	locals: App.Locals,
	url: URL,
	roles: readonly PlatformRole[] = ['moderator', 'admin']
): StaffRequestContext {
	if (locals.runtime.mode !== 'production' || !locals.supabase) {
		error(503, 'Модерационният център изисква защитена production конфигурация.');
	}

	const context = authContext(locals);
	const authorized = requireRole(context, url, roles);
	requireMfa(context, url, 'aal2');

	if (authorized.profile.role !== 'moderator' && authorized.profile.role !== 'admin') {
		error(403, 'Нямате достъп до модерационния център.');
	}

	return {
		client: locals.supabase,
		actor: {
			id: authorized.user.id,
			username: authorized.profile.username,
			role: authorized.profile.role
		}
	};
}

