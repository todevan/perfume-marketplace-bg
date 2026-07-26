import { z } from 'zod';
import {
	actionFailure,
	actionSuccess,
	type ActionError,
	type ActionErrorCode,
	type ActionResult
} from '../../contracts';
import { RepositoryError, type MarketplaceSupabaseClient } from '../repositories';

export class ServiceError extends Error {
	constructor(
		readonly code: ActionErrorCode,
		message: string,
		readonly retryable = false
	) {
		super(message);
		this.name = 'ServiceError';
	}
}

function zodActionError(error: z.ZodError): ActionError {
	const fieldErrors: Record<string, string[]> = {};
	for (const issue of error.issues) {
		const key = issue.path.length ? issue.path.join('.') : '_form';
		(fieldErrors[key] ??= []).push(issue.message);
	}
	return {
		code: 'VALIDATION',
		message: 'Please review the submitted fields.',
		fieldErrors
	};
}

function repositoryActionError(error: RepositoryError): ActionError {
	const code = error.databaseCode;
	if (code === 'PGRST116' || code === 'P0002') {
		return { code: 'NOT_FOUND', message: 'The requested record was not found.' };
	}
	if (code === '42501' || code === 'PGRST301') {
		return { code: 'FORBIDDEN', message: 'You are not allowed to perform this action.' };
	}
	if (code === '23505') {
		return { code: 'CONFLICT', message: 'This action conflicts with an existing record.' };
	}
	if (code === '23503' || code === '23514' || code === '22P02' || code === '22023') {
		return { code: 'VALIDATION', message: 'The submitted data violates a marketplace rule.' };
	}
	if (code === '429' || code === 'PGRST003' || code === '54000') {
		return { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.', retryable: true };
	}
	return { code: 'DATABASE', message: 'The marketplace could not complete the request.', retryable: true };
}

export function toActionError(error: unknown): ActionError {
	if (error instanceof z.ZodError) return zodActionError(error);
	if (error instanceof ServiceError) {
		return { code: error.code, message: error.message, retryable: error.retryable || undefined };
	}
	if (error instanceof RepositoryError) return repositoryActionError(error);
	return { code: 'INTERNAL', message: 'An unexpected error occurred.' };
}

export async function runAction<TSchema extends z.ZodType, TResult>(
	schema: TSchema,
	rawInput: unknown,
	handler: (input: z.output<TSchema>) => Promise<TResult>
): Promise<ActionResult<TResult>> {
	const parsed = schema.safeParse(rawInput);
	if (!parsed.success) return actionFailure(zodActionError(parsed.error));
	try {
		return actionSuccess(await handler(parsed.data));
	} catch (error) {
		return actionFailure(toActionError(error));
	}
}

export async function authenticatedUserId(client: MarketplaceSupabaseClient): Promise<string> {
	const { data, error } = await client.auth.getUser();
	if (error || !data.user) {
		throw new ServiceError('AUTH_REQUIRED', 'Sign in to continue.');
	}
	return data.user.id;
}

export async function runAuthenticatedAction<TSchema extends z.ZodType, TResult>(
	client: MarketplaceSupabaseClient,
	schema: TSchema,
	rawInput: unknown,
	handler: (profileId: string, input: z.output<TSchema>) => Promise<TResult>
): Promise<ActionResult<TResult>> {
	return runAction(schema, rawInput, async (input) => {
		const profileId = await authenticatedUserId(client);
		return handler(profileId, input);
	});
}
