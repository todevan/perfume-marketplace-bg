import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));

function commandScopedGitArguments(root: string, args: readonly string[]): string[] {
	return ['-c', 'safe.directory=', '-c', `safe.directory=${root}`, ...args];
}

function git(args: string[]): string {
	return execFileSync('git', commandScopedGitArguments(repositoryRoot, args), {
		cwd: repositoryRoot,
		encoding: 'utf8'
	});
}

function gitBytes(args: string[]): Buffer {
	return execFileSync('git', commandScopedGitArguments(repositoryRoot, args), {
		cwd: repositoryRoot
	});
}

describe('command-scoped Git ownership trust', () => {
	it.each([
		['POSIX path with spaces', '/workspace with spaces/repository'],
		['Windows-style path with spaces', String.raw`C:\Workspace With Spaces\repository`]
	])('resets inherited trust and adds only the exact %s root', (_label, root) => {
		const subcommand = ['ls-files', '-z', '--', '*.sql'];

		expect(commandScopedGitArguments(root, subcommand)).toEqual([
			'-c',
			'safe.directory=',
			'-c',
			`safe.directory=${root}`,
			...subcommand
		]);
	});
});

describe('database checkout contract', () => {
	it('canonicalizes the current checkout root before trusting it', () => {
		expect(repositoryRoot).toBe(realpathSync(repositoryRoot));
	});

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
