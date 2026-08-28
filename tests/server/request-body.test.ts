import { describe, expect, it } from 'vitest';
import {
	InvalidFormDataError,
	RequestBodyTooLargeError,
	parseBoundedFormData,
	STANDARD_ACTION_FORM,
	type BoundedFormDataOptions
} from '../../src/lib/server/http/request-body';

const limits: BoundedFormDataOptions = {
	maxBytes: 1024,
	maxFileBytes: 512,
	maxFiles: 1,
	maxParts: 4,
	maxHeaderBytes: 512
};

const multipartBoundary = 'request-body-test-boundary';
const textEncoder = new TextEncoder();

function multipartBody(entries: Array<[string, string | Blob]>): ReadableStream<Uint8Array> {
	let chunks: Array<string | Blob> = [];
	for (const [name, value] of entries) {
		if (typeof value === 'string') {
			chunks.push(
				`--${multipartBoundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`,
				value,
				'\r\n'
			);
			continue;
		}
		const filename = value instanceof File ? value.name : 'blob';
		chunks.push(
			`--${multipartBoundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`,
			value,
			'\r\n'
		);
	}
	chunks.push(`--${multipartBoundary}--\r\n`);

	let index = 0;
	let cancelled = false;
	return new ReadableStream<Uint8Array>({
		type: 'bytes',
		async pull(controller) {
			const chunk = chunks[index++];
			if (chunk === undefined) {
				controller.close();
				return;
			}
			const bytes =
				typeof chunk === 'string'
					? textEncoder.encode(chunk)
					: new Uint8Array(await chunk.arrayBuffer());
			if (!cancelled) controller.enqueue(bytes);
		},
		cancel() {
			cancelled = true;
			chunks = [];
		}
	});
}

function multipartRequest(entries: Array<[string, string | Blob]>, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	if (!requestHeaders.has('content-type')) {
		requestHeaders.set('content-type', `multipart/form-data; boundary=${multipartBoundary}`);
	}
	return new Request('https://example.test/upload', {
		method: 'POST',
		headers: requestHeaders,
		body: multipartBody(entries),
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
}

describe('bounded request-body parsing', () => {
	it('parses a standard text-only URL-encoded action form', async () => {
		const request = new Request('https://example.test/action', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'email=user%40example.test&next=%2Fdashboard'
		});

		const form = await parseBoundedFormData(request, STANDARD_ACTION_FORM);

		expect(form.get('email')).toBe('user@example.test');
		expect(form.get('next')).toBe('/dashboard');
	});

	it('parses a standard text-only multipart action form', async () => {
		const form = await parseBoundedFormData(
			multipartRequest([
				['email', 'user@example.test'],
				['next', '/dashboard']
			]),
			STANDARD_ACTION_FORM
		);

		expect(form.get('email')).toBe('user@example.test');
		expect(form.get('next')).toBe('/dashboard');
	});

	it('rejects standard text-only forms that exceed 64 KiB without a content length', async () => {
		const request = new Request('https://example.test/action', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: `value=${'x'.repeat(64 * 1024)}`
		});

		await expect(parseBoundedFormData(request, STANDARD_ACTION_FORM)).rejects.toMatchObject({
			name: 'RequestBodyTooLargeError',
			maxBytes: 64 * 1024
		});
	});

	it('does not trust an understated content length for standard text-only forms', async () => {
		const request = new Request('https://example.test/action', {
			method: 'POST',
			headers: {
				'content-length': '1',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: `value=${'x'.repeat(64 * 1024)}`
		});

		await expect(parseBoundedFormData(request, STANDARD_ACTION_FORM)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError
		);
	});

	it('rejects multipart files from standard text-only action forms', async () => {
		const request = multipartRequest([['attachment', new Blob(['file'])]]);

		await expect(parseBoundedFormData(request, STANDARD_ACTION_FORM)).rejects.toBeInstanceOf(
			InvalidFormDataError
		);
	});

	it('rejects more than 30 multipart parts from standard text-only action forms', async () => {
		const request = multipartRequest(
			Array.from({ length: 31 }, (_, index) => [`field-${index}`, 'value'] as [string, string])
		);

		await expect(parseBoundedFormData(request, STANDARD_ACTION_FORM)).rejects.toBeInstanceOf(
			InvalidFormDataError
		);
	});

	it('allows zero files without weakening other positive form limits', async () => {
		const request = new Request('https://example.test/action', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'value=ok'
		});

		await expect(
			parseBoundedFormData(request, { ...STANDARD_ACTION_FORM, maxBytes: 0 })
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			parseBoundedFormData(request, { ...STANDARD_ACTION_FORM, maxFileBytes: 0 })
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			parseBoundedFormData(request, { ...STANDARD_ACTION_FORM, maxParts: 0 })
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			parseBoundedFormData(request, { ...STANDARD_ACTION_FORM, maxHeaderBytes: 0 })
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			parseBoundedFormData(request, { ...STANDARD_ACTION_FORM, maxFiles: -1 })
		).rejects.toBeInstanceOf(TypeError);
	});

	it('parses multipart data through the streaming parser within every limit', async () => {
		const request = multipartRequest([
			['listingId', 'listing-1'],
			['file', new Blob(['safe'])]
		]);
		const form = await parseBoundedFormData(request, limits);
		expect(form.get('listingId')).toBe('listing-1');
		expect((form.get('file') as File).size).toBe(4);
	});

	it('rejects an oversized declared content length before consuming the stream', async () => {
		const request = new Request('https://example.test/upload', {
			method: 'POST',
			headers: {
				'content-length': '2048',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: 'a=b'
		});

		await expect(parseBoundedFormData(request, limits)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError
		);
		expect(request.bodyUsed).toBe(false);
	});

	it('caps a chunked body when content length is absent', async () => {
		const request = new Request('https://example.test/upload', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: `value=${'x'.repeat(1025)}`
		});
		await expect(parseBoundedFormData(request, limits)).rejects.toMatchObject({
			name: 'RequestBodyTooLargeError',
			maxBytes: 1024
		});
	});

	it('does not trust an understated content length', async () => {
		const request = new Request('https://example.test/upload', {
			method: 'POST',
			headers: {
				'content-length': '1',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: `value=${'x'.repeat(1025)}`
		});
		await expect(parseBoundedFormData(request, limits)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError
		);
	});

	it('enforces the stream limit for standards-valid mixed-case multipart media types', async () => {
		const boundary = 'AaB03x';
		const body = [
			`--${boundary}`,
			'Content-Disposition: form-data; name="details"',
			'',
			'x'.repeat(2048),
			`--${boundary}--`,
			''
		].join('\r\n');
		const request = new Request('https://example.test/upload', {
			method: 'POST',
			headers: { 'content-type': `Multipart/Form-Data; boundary=${boundary}` },
			body
		});

		await expect(parseBoundedFormData(request, limits)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError
		);
	});

	it('counts non-file multipart fields toward the actual total-stream limit', async () => {
		const request = multipartRequest([['details', 'x'.repeat(2048)]]);
		await expect(parseBoundedFormData(request, limits)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError
		);
	});

	it('preserves the 413 error when upstream cancellation rejects', async () => {
		const request = new Request('http://localhost/upload', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`details=${'x'.repeat(2_000)}`));
				},
				cancel() {
					return Promise.reject(new Error('hostile cancel rejection'));
				}
			}),
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });

		await expect(parseBoundedFormData(request, limits)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError
		);
	});

	it('does not wait for an upstream cancellation that never settles', async () => {
		const request = new Request('http://localhost/upload', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`details=${'x'.repeat(2_000)}`));
				},
				cancel() {
					return new Promise<void>(() => undefined);
				}
			}),
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });

		const result = Promise.race([
			parseBoundedFormData(request, limits).catch((cause: unknown) => cause),
			new Promise((resolve) => setTimeout(() => resolve(new Error('timed out')), 100))
		]);
		await expect(result).resolves.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it('enforces per-file and file-count limits while streaming multipart data', async () => {
		const oversizedFile = multipartRequest([['file', new Blob(['1234'])]]);
		await expect(
			parseBoundedFormData(oversizedFile, { ...limits, maxFileBytes: 3 })
		).rejects.toBeInstanceOf(RequestBodyTooLargeError);

		const tooManyFiles = multipartRequest([
			['file', new Blob(['one'])],
			['file', new Blob(['two'])]
		]);
		await expect(parseBoundedFormData(tooManyFiles, limits)).rejects.toBeInstanceOf(
			InvalidFormDataError
		);
	});

	it('maps malformed multipart input to a client-safe parse error', async () => {
		const request = new Request('https://example.test/upload', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data' },
			body: 'not-multipart'
		});
		await expect(parseBoundedFormData(request, limits)).rejects.toBeInstanceOf(
			InvalidFormDataError
		);
	});
});
