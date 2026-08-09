import {
	FormDataParseError,
	MaxFilesExceededError,
	MaxFileSizeExceededError,
	MaxHeaderSizeExceededError,
	MaxPartsExceededError,
	MaxTotalSizeExceededError,
	MultipartParseError,
	parseFormData
} from '@remix-run/form-data-parser';

export class RequestBodyTooLargeError extends Error {
	readonly maxBytes: number;

	constructor(maxBytes: number) {
		super(`Request body exceeds ${maxBytes} bytes`);
		this.name = 'RequestBodyTooLargeError';
		this.maxBytes = maxBytes;
	}
}

export class InvalidFormDataError extends Error {
	constructor(options?: ErrorOptions) {
		super('Request body is not valid form data', options);
		this.name = 'InvalidFormDataError';
	}
}

export interface BoundedFormDataOptions {
	readonly maxBytes: number;
	readonly maxFileBytes: number;
	readonly maxFiles: number;
	readonly maxParts: number;
	readonly maxHeaderBytes?: number;
}

export const STANDARD_ACTION_FORM: BoundedFormDataOptions = {
	maxBytes: 64 * 1024,
	maxFileBytes: 1,
	maxFiles: 0,
	maxParts: 30
};

function assertPositiveLimit(name: string, value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`${name} must be a positive safe integer`);
	}
}

function assertNonNegativeLimit(name: string, value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${name} must be a non-negative safe integer`);
	}
}

function declaredContentLength(request: Request): number | null {
	const raw = request.headers.get('content-length');
	if (raw === null) return null;
	if (!/^\d+$/.test(raw)) throw new InvalidFormDataError();
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed)) throw new InvalidFormDataError();
	return parsed;
}

function normalizedFormHeaders(request: Request): Headers {
	const raw = request.headers.get('content-type');
	if (raw === null) throw new InvalidFormDataError();
	const separator = raw.indexOf(';');
	const mediaType = (separator === -1 ? raw : raw.slice(0, separator)).trim().toLowerCase();
	if (mediaType !== 'multipart/form-data' && mediaType !== 'application/x-www-form-urlencoded') {
		throw new InvalidFormDataError();
	}
	const headers = new Headers(request.headers);
	headers.set('content-type', `${mediaType}${separator === -1 ? '' : raw.slice(separator)}`);
	return headers;
}

function boundedRequestBody(request: Request, maxBytes: number): ReadableStream<Uint8Array> {
	if (request.body === null) throw new InvalidFormDataError();
	const reader = request.body.getReader();
	let observedBytes = 0;
	let readerReleased = false;
	const releaseReader = () => {
		if (readerReleased) return;
		try {
			reader.releaseLock();
			readerReleased = true;
		} catch {
			// A pending runtime read/cancel may temporarily retain the lock.
		}
	};
	const cancelReader = (reason: unknown) => {
		try {
			void reader.cancel(reason).catch(() => undefined);
		} catch {
			// Cancellation is best-effort and never replaces the boundary error.
		} finally {
			releaseReader();
		}
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			let result: ReadableStreamReadResult<Uint8Array>;
			try {
				result = await reader.read();
			} catch (cause) {
				releaseReader();
				controller.error(cause);
				return;
			}
			if (result.done) {
				releaseReader();
				controller.close();
				return;
			}
			observedBytes += result.value.byteLength;
			if (observedBytes > maxBytes) {
				cancelReader('request_body_too_large');
				controller.error(new RequestBodyTooLargeError(maxBytes));
				return;
			}
			controller.enqueue(result.value);
		},
		cancel(reason) {
			cancelReader(reason);
		}
	});
}

function causedByRequestBodyLimit(cause: unknown): boolean {
	let current = cause;
	const visited = new Set<unknown>();
	while (current !== null && typeof current === 'object' && !visited.has(current)) {
		if (current instanceof RequestBodyTooLargeError) return true;
		visited.add(current);
		current = 'cause' in current ? current.cause : null;
	}
	return false;
}

export async function parseBoundedFormData(
	request: Request,
	options: BoundedFormDataOptions
): Promise<FormData> {
	assertPositiveLimit('maxBytes', options.maxBytes);
	assertPositiveLimit('maxFileBytes', options.maxFileBytes);
	assertNonNegativeLimit('maxFiles', options.maxFiles);
	assertPositiveLimit('maxParts', options.maxParts);
	const maxHeaderBytes = options.maxHeaderBytes ?? 8 * 1024;
	assertPositiveLimit('maxHeaderBytes', maxHeaderBytes);

	const declaredBytes = declaredContentLength(request);
	if (declaredBytes !== null && declaredBytes > options.maxBytes) {
		throw new RequestBodyTooLargeError(options.maxBytes);
	}
	const boundedRequest = new Request(request.url, {
		method: request.method,
		headers: normalizedFormHeaders(request),
		body: boundedRequestBody(request, options.maxBytes),
		signal: request.signal,
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });

	try {
		return await parseFormData(boundedRequest, {
			maxTotalSize: options.maxBytes,
			// The underlying multipart parser applies this limit to text parts too.
			// With zero permitted files, the bounded stream and maxFiles check remain
			// authoritative while text-only multipart forms can use the full body budget.
			maxFileSize: options.maxFiles === 0 ? options.maxBytes : options.maxFileBytes,
			maxFiles: options.maxFiles,
			maxParts: options.maxParts,
			maxHeaderSize: maxHeaderBytes
		});
	} catch (cause) {
		if (causedByRequestBodyLimit(cause)) {
			throw new RequestBodyTooLargeError(options.maxBytes);
		}
		if (
			cause instanceof MaxTotalSizeExceededError ||
			cause instanceof MaxFileSizeExceededError ||
			cause instanceof MaxHeaderSizeExceededError
		) {
			throw new RequestBodyTooLargeError(options.maxBytes);
		}
		if (
			cause instanceof MaxFilesExceededError ||
			cause instanceof MaxPartsExceededError ||
			cause instanceof FormDataParseError ||
			cause instanceof MultipartParseError ||
			cause instanceof TypeError
		) {
			throw new InvalidFormDataError({ cause });
		}
		throw cause;
	}
}
