import { error, redirect } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';
import { loginRedirect, safeRedirectPath } from './redirect';
import type {
	AuthenticatedBetaContext,
	AuthenticatorAssuranceLevel,
	PlatformRole,
	RequestAuthContext
} from './types';

export type RouteAccessPolicy = 'public' | 'authenticated' | 'beta' | 'staff' | 'staff-aal1';

const PUBLIC_ROUTE_PREFIXES = ['/legal'];
const PUBLIC_EXACT_ROUTES = new Set([
	'/login',
	'/safety',
	'/robots.txt',
	'/sitemap.xml',
	'/auth/callback',
	'/auth/confirm',
	'/auth/error',
	'/auth/reset-password'
]);
const AUTHENTICATED_EXACT_ROUTES = new Set(['/auth/logout', '/auth/update-password']);
const AUTHENTICATED_ROUTE_PREFIXES = ['/onboarding', '/phone-verification'];
const STAFF_ROUTE_PREFIXES = ['/admin'];

function isWithin(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Production access is default-deny: an unclassified application route is private beta. */
export function routeAccessPolicy(pathname: string): RouteAccessPolicy {
	const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
	if (
		PUBLIC_EXACT_ROUTES.has(normalizedPath) ||
		PUBLIC_ROUTE_PREFIXES.some((prefix) => isWithin(normalizedPath, prefix))
	) {
		return 'public';
	}
	if (normalizedPath === '/auth/mfa') return 'staff-aal1';
	if (AUTHENTICATED_EXACT_ROUTES.has(normalizedPath)) return 'authenticated';
	if (AUTHENTICATED_ROUTE_PREFIXES.some((prefix) => isWithin(normalizedPath, prefix))) {
		return 'authenticated';
	}
	if (STAFF_ROUTE_PREFIXES.some((prefix) => isWithin(normalizedPath, prefix))) return 'staff';
	return 'beta';
}

export function requireAuthenticated(context: RequestAuthContext, url: URL): User {
	if (!context.user) redirect(303, loginRedirect(url));
	return context.user;
}

export function requireBetaAccess(
	context: RequestAuthContext,
	url: URL
): AuthenticatedBetaContext {
	const user = requireAuthenticated(context, url);
	const { profile, betaAccess } = context;

	if (profile?.isSuspended || betaAccess?.status === 'suspended') {
		error(403, 'Този профил е временно спрян.');
	}
	if (betaAccess?.status === 'revoked') {
		error(403, 'Нямате активен достъп до затворената beta.');
	}
	if (!profile || !betaAccess || !betaAccess.onboardingCompletedAt) {
		redirect(303, `/onboarding?next=${encodeURIComponent(safeRedirectPath(`${url.pathname}${url.search}`, '/'))}`);
	}
	if (!betaAccess.isActive || betaAccess.status !== 'active') {
		error(403, 'Нямате активен достъп до затворената beta.');
	}

	return { user, profile, betaAccess };
}

export function requireRole(
	context: RequestAuthContext,
	url: URL,
	roles: readonly PlatformRole[]
): AuthenticatedBetaContext {
	const authorized = requireBetaAccess(context, url);
	if (!roles.includes(authorized.profile.role)) error(403, 'Нямате достъп до тази страница.');
	return authorized;
}

export function requireMfa(
	context: RequestAuthContext,
	url: URL,
	requiredLevel: AuthenticatorAssuranceLevel = 'aal2'
): void {
	if (requiredLevel === 'aal2' && context.currentAal !== 'aal2') {
		const next = safeRedirectPath(`${url.pathname}${url.search}`, '/dashboard');
		redirect(303, `/auth/mfa?next=${encodeURIComponent(next)}`);
	}
}

export function requireVerifiedPhone(context: RequestAuthContext, url: URL): void {
	const authorized = requireBetaAccess(context, url);
	if (!authorized.profile.phoneVerifiedAt) {
		const next = safeRedirectPath(`${url.pathname}${url.search}`, '/dashboard');
		redirect(303, `/phone-verification?next=${encodeURIComponent(next)}`);
	}
}

export function enforceRoutePolicy(context: RequestAuthContext, url: URL): void {
	switch (routeAccessPolicy(url.pathname)) {
		case 'public':
			return;
		case 'authenticated':
			requireAuthenticated(context, url);
			return;
		case 'staff':
			requireRole(context, url, ['moderator', 'admin']);
			requireMfa(context, url);
			return;
		case 'staff-aal1':
			requireRole(context, url, ['moderator', 'admin']);
			return;
		case 'beta':
			requireBetaAccess(context, url);
	}
}
