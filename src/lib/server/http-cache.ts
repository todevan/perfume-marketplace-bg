import { routeAccessPolicy } from '$lib/server/auth/guards';

export function shouldUsePrivateResponse(
	method: string,
	pathname: string,
	hasAuthenticatedUser: boolean,
	responseStatus = 200
): boolean {
	const normalizedMethod = method.toUpperCase();
	const mutatesState = normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
	const isErrorResponse = responseStatus >= 400;

	return (
		mutatesState ||
		isErrorResponse ||
		routeAccessPolicy(pathname) !== 'public' ||
		hasAuthenticatedUser
	);
}
