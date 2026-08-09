import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const listingUploadRoute = readFileSync(
	new URL('../../src/routes/api/listing-uploads/+server.ts', import.meta.url),
	'utf8'
);
const reportRoute = readFileSync(
	new URL('../../src/routes/report/+page.server.ts', import.meta.url),
	'utf8'
);

describe('multipart request-size boundaries', () => {
	it('bounds listing image requests before multipart parsing and returns 413', () => {
		expect(listingUploadRoute).toContain('parseBoundedFormData(event.request');
		expect(listingUploadRoute).toContain('RequestBodyTooLargeError');
		expect(listingUploadRoute).toContain("status: 413");
		expect(listingUploadRoute).not.toContain('event.request.formData()');
	});

	it('bounds multi-file report requests before multipart parsing and returns 413', () => {
		expect(reportRoute).toContain('parseBoundedFormData(event.request');
		expect(reportRoute).toContain('RequestBodyTooLargeError');
		expect(reportRoute).toContain('fail(413');
		expect(reportRoute).not.toContain('event.request.formData()');
		expect(reportRoute).toContain('InvalidFormDataError');
		expect(reportRoute.indexOf('if (!event.locals.user)')).toBeLessThan(
			reportRoute.indexOf('parseBoundedFormData(event.request')
		);
	});
});
