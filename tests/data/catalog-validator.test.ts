import { spawnSync } from 'node:child_process';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = resolve(import.meta.dirname, '../..');
const validator = resolve(workspace, 'scripts/validate-catalog.mjs');
const catalogPath = resolve(workspace, 'catalog/brand-categories.json');
const schemaPath = resolve(workspace, 'catalog/brand-categories.schema.json');

describe('catalog validator', () => {
	it('rejects aliases that collapse to the same database search key', () => {
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'perfume-catalog-'));

		try {
			const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
				brands: Array<{
					id: string;
					aliases: Array<{ type: string; value: string }>;
				}>;
			};
			const brand = catalog.brands.find(
				(candidate) =>
					candidate.id === 'brand-editions-de-parfums-frederic-malle'
			);
			expect(brand).toBeDefined();
			brand?.aliases.push({
				type: 'searchAlias',
				value: 'Frederic Malle'
			});

			const invalidCatalogPath = join(temporaryDirectory, 'catalog.json');
			writeFileSync(invalidCatalogPath, JSON.stringify(catalog), 'utf8');

			const result = spawnSync(
				process.execPath,
				[validator, invalidCatalogPath, schemaPath],
				{ cwd: workspace, encoding: 'utf8' }
			);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain('normalizes to the same key');
		} finally {
			rmSync(temporaryDirectory, { force: true, recursive: true });
		}
	});
});
