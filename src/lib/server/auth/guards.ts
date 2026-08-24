import { error, redirect } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';
import { loginRedirect, safeRedirectPath } from './redirect';
import type {
	AuthenticatedBetaContext,
	AuthenticatorAssuranceLevel,
	AuthProfile,
	BetaAccess,
	PlatformRole,
	RequestAuthContext
} from './types';

export type RouteAccessPolicy = 'public' | 'authenticated' | 'beta' | 'staff' | 'staff-aal1';

/**
 * Auth data that a route needs after access authorization. This deliberately
 * remains separate from RouteAccessPolicy: public and authenticated routes can
 * still need a narrow subset of context to render or complete an action.
 */
export interface RouteAuthDataRequirements {
	user: true;
	profile: boolean;
	betaAccess: boolean;
	aal: boolean;
}

const PUBLIC_ROUTE_PREFIXES = ['/legal'];
const PUBLIC_NAVIGATION_EXACT_ROUTES = new Set([
	'/login',
	'/safety',
	'/auth/error',
	'/auth/reset-password'
]);
const PUBLIC_TECHNICAL_EXACT_ROUTES = new Set([
	'/robots.txt',
	'/sitemap.xml',
	'/auth/callback',
	'/auth/confirm'
]);
const PUBLIC_EXACT_ROUTES = new Set([
	...PUBLIC_NAVIGATION_EXACT_ROUTES,
	...PUBLIC_TECHNICAL_EXACT_ROUTES
]);
const AUTHENTICATED_EXACT_ROUTES = new Set(['/auth/logout', '/auth/update-password']);
const AUTHENTICATED_ROUTE_PREFIXES = ['/onboarding'];
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

/**
 * Declares the smallest context each route consumer requires. Anonymous
 * requests never query these optional pieces because the hook only loads them
 * after getUser() returns an authenticated user.
 */
export function routeAuthDataRequirements(pathname: string): RouteAuthDataRequirements {
	const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
	const policy = routeAccessPolicy(normalizedPath);

	switch (policy) {
		case 'beta':
			return { user: true, profile: true, betaAccess: true, aal: false };
		case 'staff':
			return { user: true, profile: true, betaAccess: true, aal: true };
		case 'staff-aal1':
			return { user: true, profile: true, betaAccess: true, aal: true };
		case 'authenticated':
			if (AUTHENTICATED_ROUTE_PREFIXES.some((prefix) => isWithin(normalizedPath, prefix))) {
				return { user: true, profile: true, betaAccess: true, aal: false };
			}
			if (normalizedPath === '/auth/update-password') {
				return { user: true, profile: false, betaAccess: true, aal: false };
			}
			return { user: true, profile: false, betaAccess: false, aal: false };
		case 'public':
			if (
				PUBLIC_NAVIGATION_EXACT_ROUTES.has(normalizedPath) ||
				PUBLIC_ROUTE_PREFIXES.some((prefix) => isWithin(normalizedPath, prefix))
			) {
				return { user: true, profile: false, betaAccess: true, aal: false };
			}
			return { user: true, profile: false, betaAccess: false, aal: false };
	}
}

export function requireAuthenticated(context: RequestAuthContext, url: URL): User {
	if (!context.user) redirect(303, loginRedirect(url));
	return context.user;
}

type ConsentRenewalProfile = Pick<AuthProfile, 'emailVerifiedAt' | 'isSuspended'>;
type ConsentRenewalAccess = Pick<
	BetaAccess,
	'status' | 'onboardingCompletedAt' | 'expiresAt' | 'hasCurrentConsents'
>;

/** True only when current consent is the sole remaining beta-access requirement. */
export function requiresConsentRenewal(
	profile: ConsentRenewalProfile | null,
	betaAccess: ConsentRenewalAccess | null,
	now = Date.now()
): boolean {
	if (
		!profile ||
		profile.isSuspended ||
		!profile.emailVerifiedAt ||
		!betaAccess ||
		betaAccess.status !== 'active' ||
		!betaAccess.onboardingCompletedAt ||
		betaAccess.hasCurrentConsents
	) {
		return false;
	}

	if (!betaAccess.expiresAt) return true;
	const expiresAt = new Date(betaAccess.expiresAt).getTime();
	return Number.isFinite(expiresAt) && expiresAt > now;
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
	if (betaAccess?.status === 'expired') {
		error(403, 'Достъпът до затворената beta е изтекъл.');
	}
	if (!profile || !betaAccess || !betaAccess.onboardingCompletedAt) {
		redirect(303, `/onboarding?next=${encodeURIComponent(safeRedirectPath(`${url.pathname}${url.search}`, '/'))}`);
	}
	if (requiresConsentRenewal(profile, betaAccess)) {
		redirect(303, `/onboarding?next=${encodeURIComponent(safeRedirectPath(`${url.pathname}${url.search}`, '/'))}`);
	}
	if (betaAccess.status === 'active' && !profile.emailVerifiedAt) {
		error(403, 'Имейл адресът трябва да бъде потвърден.');
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
