import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface TomlNode {
	[key: string]: boolean | number | string | TomlNode;
}

const workspace = resolve(import.meta.dirname, '../..');
const configPath = resolve(workspace, 'supabase/config.toml');
const confirmationTemplatePath = resolve(workspace, 'supabase/templates/confirmation.html');
const environmentExamplePath = resolve(workspace, '.env.example');

function parseContractToml(source: string): TomlNode {
	const root: TomlNode = {};
	let section = root;

	for (const sourceLine of source.split(/\r?\n/u)) {
		const line = sourceLine.trim();
		if (!line || line.startsWith('#')) continue;

		const table = line.match(/^\[([\w.]+)\]$/u);
		if (table) {
			section = table[1].split('.').reduce<TomlNode>((node, key) => {
				const child = node[key];
				if (typeof child === 'object') return child;
				const created: TomlNode = {};
				node[key] = created;
				return created;
			}, root);
			continue;
		}

		const assignment = line.match(/^(\w+)\s*=\s*(true|false|\d+|"(?:[^"\\]|\\.)*")$/u);
		if (!assignment) continue;
		section[assignment[1]] =
			assignment[2] === 'true'
				? true
				: assignment[2] === 'false'
					? false
					: /^\d+$/u.test(assignment[2])
						? Number(assignment[2])
						: (JSON.parse(assignment[2]) as string);
	}

	return root;
}

describe('open registration Supabase configuration', () => {
	it('enables only confirmed email/password registration with Turnstile', () => {
		const config = parseContractToml(readFileSync(configPath, 'utf8')) as {
			auth: {
				enable_signup: boolean;
				enable_anonymous_sign_ins: boolean;
				minimum_password_length: number;
				captcha: { enabled: boolean; provider: string; secret: string };
				email: {
					enable_signup: boolean;
					enable_confirmations: boolean;
					template: { confirmation: { content_path: string } };
				};
				sms: { enable_signup: boolean };
			};
		};

		expect(config.auth.enable_signup).toBe(true);
		expect(config.auth.email.enable_signup).toBe(true);
		expect(config.auth.email.enable_confirmations).toBe(true);
		expect(config.auth.sms.enable_signup).toBe(false);
		expect(config.auth.enable_anonymous_sign_ins).toBe(false);
		expect(config.auth.minimum_password_length).toBe(12);
		expect(config.auth.captcha.enabled).toBe(true);
		expect(config.auth.captcha.provider).toBe('turnstile');
		expect(config.auth.captcha.secret).toBe('env(LOCAL_AUTH_CAPTCHA_TEST_KEY)');
		expect(config.auth.email.template.confirmation.content_path).toBe(
			'./supabase/templates/confirmation.html'
		);
	});

	it('routes confirmation email links through the server confirmation boundary', () => {
		expect(existsSync(confirmationTemplatePath)).toBe(true);
		if (!existsSync(confirmationTemplatePath)) return;

		const template = readFileSync(confirmationTemplatePath, 'utf8');
		expect(template).toContain('{{ .TokenHash }}');
		expect(template).toContain('{{ .RedirectTo }}');
		expect(template).toContain('type=email');
	});

	it('documents the local CAPTCHA secret without retaining the obsolete invite switch', () => {
		const environmentExample = readFileSync(environmentExamplePath, 'utf8');

		expect(environmentExample).toContain('LOCAL_AUTH_CAPTCHA_TEST_KEY=');
		expect(environmentExample).not.toContain('PRIVATE_BETA_REQUIRE_INVITE');
	});
});
