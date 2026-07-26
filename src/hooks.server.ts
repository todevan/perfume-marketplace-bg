import { createServerClient } from '@supabase/ssr';
import { isRedirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { AuthContextError, loadRequestAuthContext } from '$lib/server/auth/context';
import { enforceRoutePolicy, routeAccessPolicy } from '$lib/server/auth/guards';
import type { RequestAuthContext } from '$lib/server/auth/types';
import {
	getPlatformEnvironment,
	getRuntimeConfiguration,
	RuntimeConfigurationError,
	type RuntimeConfiguration
} from '$lib/server/env';

const EMPTY_AUTH_CONTEXT: RequestAuthContext = Object.freeze({
	user: null,
	profile: null,
	betaAccess: null,
	currentAal: null,
	nextAal: null
});

function serviceUnavailable(requestId: string): Response {
	return new Response('Authentication service is unavailable.', {
		status: 503,
		headers: {
			'cache-control': 'private, no-store',
			'content-type': 'text/plain; charset=utf-8',
			'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
			'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=()',
			'referrer-policy': 'no-referrer',
			'retry-after': '60',
			'x-content-type-options': 'nosniff',
			'x-frame-options': 'DENY',
			'x-request-id': requestId
		}
	});
}

function cspFor(runtime: RuntimeConfiguration): string {
	const connectSources = ["'self'", 'https://challenges.cloudflare.com'];
	const imageSources = ["'self'", 'data:', 'blob:'];
	if (runtime.mode === 'production') {
		const origin = new URL(runtime.publicSupabaseUrl).origin;
		connectSources.push(origin, origin.replace(/^https:/, 'wss:'));
		imageSources.push(origin);
	}

	return [
		"default-src 'self'",
		"base-uri 'self'",
		`connect-src ${connectSources.join(' ')}`,
		"font-src 'self' data:",
		`frame-src 'self' https://challenges.cloudflare.com`,
		"frame-ancestors 'none'",
		`img-src ${imageSources.join(' ')}`,
		"object-src 'none'",
		"form-action 'self'",
		"script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
		"style-src 'self' 'unsafe-inline'"
	].join('; ');
}

function applySecurityHeaders(
	response: Response,
	requestId: string,
	runtime: RuntimeConfiguration,
	privateResponse: boolean
): Response {
	response.headers.set('content-security-policy', cspFor(runtime));
	response.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=(), payment=()');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('x-request-id', requestId);
	if (privateResponse) {
		response.headers.set('cache-control', 'private, no-store');
		response.headers.append('vary', 'Cookie');
	}
	return response;
}

function setAuthContext(locals: App.Locals, context: RequestAuthContext): void {
	locals.user = context.user;
	locals.userId = context.user?.id;
	locals.profile = context.profile;
	locals.betaAccess = context.betaAccess;
	locals.currentAal = context.currentAal;
	locals.nextAal = context.nextAal;
}

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID();
	event.locals.requestId = requestId;

	// Static files do not have a SvelteKit route id and never need auth initialization.
	if (!event.route.id) return resolve(event);

	let runtime: RuntimeConfiguration;
	try {
		runtime = getRuntimeConfiguration(getPlatformEnvironment(event.platform));
	} catch (cause) {
		if (cause instanceof RuntimeConfigurationError) return serviceUnavailable(requestId);
		throw cause;
	}
	event.locals.runtime = runtime;

	if (runtime.mode === 'demo') {
		event.locals.supabase = null;
		event.locals.safeGetSession = async () => ({ session: null, user: null });
		setAuthContext(event.locals, EMPTY_AUTH_CONTEXT);

		const response = await resolve(event);
		return applySecurityHeaders(response, requestId, runtime, true);
	}

	const forwardedAuthHeaders = new Set<string>();
	const supabase = createServerClient(runtime.publicSupabaseUrl, runtime.publicSupabaseKey, {
		auth: { flowType: 'pkce' },
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, { ...options, path: '/' });
				}
				const newHeaders = Object.fromEntries(
					Object.entries(headers).filter(([name]) => {
						const normalized = name.toLowerCase();
						if (forwardedAuthHeaders.has(normalized)) return false;
						forwardedAuthHeaders.add(normalized);
						return true;
					})
				);
				if (Object.keys(newHeaders).length > 0) event.setHeaders(newHeaders);
			}
		},
		global: {
			fetch: event.fetch,
			headers: {
				'X-Client-Info': 'perfume-marketplace-sveltekit',
				'X-Request-ID': requestId
			}
		}
	});
	event.locals.supabase = supabase;
	event.locals.safeGetSession = async () => {
		const { data: userData, error: userError } = await supabase.auth.getUser();
		if (userError || !userData.user) return { session: null, user: null };
		const { data: sessionData } = await supabase.auth.getSession();
		return { session: sessionData.session, user: userData.user };
	};

	let context: RequestAuthContext;
	try {
		context = await loadRequestAuthContext(supabase);
	} catch (cause) {
		if (cause instanceof AuthContextError) return serviceUnavailable(requestId);
		throw cause;
	}
	setAuthContext(event.locals, context);
	try {
		enforceRoutePolicy(context, event.url);
	} catch (cause) {
		if (isRedirect(cause)) {
			return applySecurityHeaders(
				new Response(null, { status: cause.status, headers: { location: cause.location } }),
				requestId,
				runtime,
				true
			);
		}
		throw cause;
	}

	const response = await resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
	const privateResponse = routeAccessPolicy(event.url.pathname) !== 'public' || Boolean(context.user);
	return applySecurityHeaders(response, requestId, runtime, privateResponse);
};

export const handleError: HandleServerError = ({ event, status }) => {
	const requestId = event.locals.requestId ?? crypto.randomUUID();
	return {
		message: status >= 500 ? 'Възникна временен проблем. Опитай отново.' : 'Заявката не можа да бъде изпълнена.',
		requestId
	};
};
