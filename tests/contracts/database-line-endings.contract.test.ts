import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

function git(args: string[]): string {
	return execFileSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8'
	});
}

function gitBytes(args: string[]): Buffer {
	return execFileSync('git', args, { cwd: repositoryRoot });
}

describe('database checkout contract', () => {
	it('materializes every tracked SQL file with LF line endings', () => {
		const sqlFiles = git(['ls-files', '-z', '--', '*.sql']).split('\0').filter(Boolean);
		expect(sqlFiles.length).toBeGreaterThan(0);

		const fields = git(['check-attr', '-z', 'text', 'eol', '--', ...sqlFiles]).split('\0');
		const attributes = new Map<string, Map<string, string>>();
		for (let index = 0; index + 2 < fields.length; index += 3) {
			const [file, attribute, value] = fields.slice(index, index + 3);
			if (!file || !attribute || !value) continue;
			const fileAttributes = attributes.get(file) ?? new Map<string, string>();
			fileAttributes.set(attribute, value);
			attributes.set(file, fileAttributes);
		}

		const violations = sqlFiles.flatMap((file) => {
			const fileAttributes = attributes.get(file);
			return fileAttributes?.get('text') === 'set' && fileAttributes.get('eol') === 'lf'
				? []
				: [
						`${file}: text=${fileAttributes?.get('text') ?? 'missing'}, eol=${fileAttributes?.get('eol') ?? 'missing'}`
					];
		});

		expect(violations).toEqual([]);
	});

	it('stores every tracked SQL file without canonical CRLF bytes', () => {
		const sqlFiles = git(['ls-files', '-z', '--', '*.sql']).split('\0').filter(Boolean);
		const crlfFiles = sqlFiles.filter((file) =>
			gitBytes(['show', `:${file}`]).includes(Buffer.from('\r\n'))
		);

		expect(crlfFiles).toEqual([]);
	});
});
