import { z } from 'zod';

export const actionErrorCodeSchema = z.enum([
	'VALIDATION',
	'AUTH_REQUIRED',
	'FORBIDDEN',
	'NOT_FOUND',
	'CONFLICT',
	'RATE_LIMITED',
	'DATABASE',
	'INTERNAL'
]);

export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>;

export interface ActionError {
	readonly code: ActionErrorCode;
	readonly message: string;
	readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
	readonly retryable?: boolean;
}

export type ActionResult<T> =
	| { readonly ok: true; readonly data: T }
	| { readonly ok: false; readonly error: ActionError };

export function actionSuccess<T>(data: T): ActionResult<T> {
	return { ok: true, data };
}

export function actionFailure<T = never>(error: ActionError): ActionResult<T> {
	return { ok: false, error };
}

