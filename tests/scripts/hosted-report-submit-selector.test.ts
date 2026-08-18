import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('hosted A10 report submit selector', () => {
	it('targets the report submit action by accessible name and avoids the ambiguous generic submit selector', async () => {
		const hostedSpec = await readFile(
			new URL('../e2e/hosted-report-evidence.spec.ts', import.meta.url),
			'utf8'
		);

		expect(hostedSpec).toContain("getByRole('button', { name: 'Изпрати сигнала' })");
		expect(hostedSpec).not.toContain("locator('form button[type=\"submit\"]')");
	});
});
