import { createServerClient } from '@supabase/ssr';
import { version as deployedGitSha } from '$app/environment';
import { isHttpError, isRedirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { AuthContextError, loadRequestAuthContext } from '$lib/server/auth/context';
import { enforceRoutePolicy } from '$lib/server/auth/guards';
import type { RequestAuthContext } from '$lib/server/auth/types';
import {
	getPlatformEnvironment,
	getRuntimeConfiguration,
	RuntimeConfigurationError,
	type RuntimeConfiguration
} from '$lib/server/env';
import { shouldUsePrivateResponse } from '$lib/server/http-cache';
import { UnexpectedServiceError } from '$lib/server/services/action';

const EMPTY_AUTH_CONTEXT: RequestAuthContext = Object.freeze({
	user: null,
	profile: null,
	betaAccess: null,
	currentAal: null,
	nextAal: null
});

function serviceUnavailable(requestId: string, secureTransport = false): Response {
	const headers: Record<string, string> = {
		'cache-control': 'private, no-store',
		'content-type': 'text/plain; charset=utf-8',
		'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
		'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=()',
		'referrer-policy': 'no-referrer',
		'retry-after': '60',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
		'x-deployed-git-sha': deployedGitSha,
		'x-request-id': requestId
	};
	if (secureTransport) {
		headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
	}
	return new Response('Authentication service is unavailable.', {
		status: 503,
		headers
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
	response.headers.set('x-deployed-git-sha', deployedGitSha);
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('x-request-id', requestId);
	if (runtime.appEnvironment === 'production') {
		response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}
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

	let runtime: RuntimeConfiguration;
	try {
		runtime = getRuntimeConfiguration(getPlatformEnvironment(event.platform));
	} catch (cause) {
		if (cause instanceof RuntimeConfigurationError) {
			return serviceUnavailable(requestId, event.url.protocol === 'https:');
		}
		throw cause;
	}
	event.locals.runtime = runtime;

	if (!event.route.id) {
		const response = await resolve(event);
		return applySecurityHeaders(
			response,
			requestId,
			runtime,
			shouldUsePrivateResponse(
				event.request.method,
				event.url.pathname,
				false,
				response.status
			)
		);
	}

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
		if (cause instanceof AuthContextError) {
			return serviceUnavailable(requestId, event.url.protocol === 'https:');
		}
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
		if (isHttpError(cause)) {
			return applySecurityHeaders(
				new Response(cause.body.message, {
					status: cause.status,
					headers: { 'content-type': 'text/plain; charset=utf-8' }
				}),
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
	const privateResponse = shouldUsePrivateResponse(
		event.request.method,
		event.url.pathname,
		Boolean(context.user),
		response.status
	);
	return applySecurityHeaders(response, requestId, runtime, privateResponse);
};

export const handleError: HandleServerError = ({ error, event, status }) => {
	const requestId = event.locals.requestId ?? crypto.randomUUID();
	console.error(
		JSON.stringify({
			event: 'request_unexpected_failure',
			requestId,
			routeId: event.route.id ?? null,
			method: event.request.method,
			path: event.url.pathname,
			status,
			errorType:
				error instanceof UnexpectedServiceError
					? error.errorType
					: error instanceof Error
						? error.name
						: typeof error,
			operation: error instanceof UnexpectedServiceError ? error.operation : null
		})
	);
	return {
		message: status >= 500 ? 'Възникна временен проблем. Опитай отново.' : 'Заявката не можа да бъде изпълнена.',
		requestId
	};
};
