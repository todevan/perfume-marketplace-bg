import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = readdirSync(migrationsUrl)
	.filter((filename) => filename.endsWith('.sql'))
	.sort();

test('deal_cancelled is added in a dedicated forward migration', () => {
	const additions = migrationFiles
		.map((filename) => ({
			filename,
			sql: readFileSync(new URL(filename, migrationsUrl), 'utf8')
				.toLowerCase()
				.replace(/\r\n/gu, '\n')
		}))
		.filter(({ sql }) =>
			/alter\s+type\s+public\.notification_kind\s+add\s+value(?:\s+if\s+not\s+exists)?\s+'deal_cancelled'/u.test(
				sql
			)
		);

	assert.equal(additions.length, 1, 'expected exactly one deal_cancelled enum migration');
	assert.doesNotMatch(
		additions[0].sql,
		/create\s+(?:or\s+replace\s+)?function\s+public\.(?:complete_deal|cancel_deal)/u,
		'notification enum migration must not contain lifecycle RPCs'
	);
});
