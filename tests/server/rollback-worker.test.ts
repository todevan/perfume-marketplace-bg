import { describe, expect, it } from 'vitest';
import worker from '../../src/rollback-worker';

describe('attributable fail-closed rollback worker', () => {
	it('serves only the rollback 503 contract and binds the candidate Git SHA', async () => {
		const sha = 'a'.repeat(40);
		const response = await worker.fetch(new Request('https://staging.example.test/dashboard'), {
			ROLLBACK_SOURCE_GIT_SHA: sha
		});

		expect(response.status).toBe(503);
		expect(response.headers.get('x-deployed-git-sha')).toBe(sha);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('retry-after')).toBe('60');
		expect(await response.text()).toBe('Authentication service is unavailable.');
	});

	it.each(['', 'not-a-sha', 'A'.repeat(40)])(
		'refuses unattributable rollback input (%s)',
		async (sha) => {
			const response = await worker.fetch(new Request('https://staging.example.test/'), {
				ROLLBACK_SOURCE_GIT_SHA: sha
			});
			expect(response.status).toBe(503);
			expect(response.headers.get('x-deployed-git-sha')).toBeNull();
			expect(await response.text()).toBe('Rollback artifact is not attributable.');
		}
	);
});
