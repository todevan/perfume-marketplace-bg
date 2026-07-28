import { describe, expect, it } from 'vitest';
import { shouldUsePrivateResponse } from '../../src/lib/server/http-cache';

describe('HTTP cache policy', () => {
	it('makes every state-changing request private and no-store eligible', () => {
		expect(shouldUsePrivateResponse('POST', '/login', false)).toBe(true);
		expect(shouldUsePrivateResponse('DELETE', '/auth/logout', false)).toBe(true);
	});

	it('keeps anonymous public reads cacheable and protects authenticated reads', () => {
		expect(shouldUsePrivateResponse('GET', '/login', false)).toBe(false);
		expect(shouldUsePrivateResponse('HEAD', '/safety', false)).toBe(false);
		expect(shouldUsePrivateResponse('GET', '/login', true)).toBe(true);
		expect(shouldUsePrivateResponse('GET', '/dashboard', false)).toBe(true);
	});

	it('keeps public error responses out of shared caches', () => {
		expect(shouldUsePrivateResponse('GET', '/login', false, 503)).toBe(true);
		expect(shouldUsePrivateResponse('GET', '/sitemap.xml', false, 404)).toBe(true);
	});
});
