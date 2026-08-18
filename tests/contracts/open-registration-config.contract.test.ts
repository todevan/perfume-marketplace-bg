import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = resolve(import.meta.dirname, '../..');
const supabaseConfig = readFileSync(resolve(workspace, 'supabase/config.toml'), 'utf8');
const exampleEnvironment = readFileSync(resolve(workspace, '.env.example'), 'utf8');
const confirmationTemplate = readFileSync(
	resolve(workspace, 'supabase/templates/confirmation.html'),
	'utf8'
);

function tomlBoolean(section: string, key: string): boolean | undefined {
	const sectionPattern = new RegExp(
		`^\\[${section.replaceAll('.', '\\.')}\\]\\r?\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`,
		'm'
	);
	const sectionBody = sectionPattern.exec(supabaseConfig)?.[1];
	const value = sectionBody
		? new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, 'mu').exec(sectionBody)?.[1]
		: undefined;
	return value === undefined ? undefined : value === 'true';
}

function exampleEnvironmentMap(): Map<string, string> {
	return new Map(
		exampleEnvironment
			.split(/\r?\n/u)
			.filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
			.map((line) => {
				const separator = line.indexOf('=');
				return [line.slice(0, separator), line.slice(separator + 1)];
			})
	);
}

describe('open registration configuration', () => {
	it('enables email signup with confirmation while phone and anonymous signup stay disabled', () => {
		expect(tomlBoolean('auth', 'enable_signup')).toBe(true);
		expect(tomlBoolean('auth', 'enable_anonymous_sign_ins')).toBe(false);
		expect(tomlBoolean('auth.email', 'enable_signup')).toBe(true);
		expect(tomlBoolean('auth.email', 'enable_confirmations')).toBe(true);
		expect(tomlBoolean('auth.sms', 'enable_signup')).toBe(false);
		expect(tomlBoolean('auth.captcha', 'enabled')).toBe(true);
		expect(supabaseConfig).toMatch(/\[auth\.captcha\][\s\S]*provider\s*=\s*"turnstile"/u);
		expect(supabaseConfig).toMatch(/secret\s*=\s*"env\(LOCAL_AUTH_CAPTCHA_TEST_KEY\)"/u);
		expect(supabaseConfig).toMatch(/\[auth\.email\.template\.confirmation\]/u);
	});

	it('generates the provider token-hash email link consumed by the SSR handler', () => {
		expect(confirmationTemplate).toContain('{{ .RedirectTo }}');
		expect(confirmationTemplate).toContain('token_hash={{ .TokenHash }}');
		expect(confirmationTemplate).toContain('type=email');
		expect(confirmationTemplate).not.toContain('type=signup');
	});

	it('does not advertise an invite requirement while retaining staff MFA', () => {
		const environment = exampleEnvironmentMap();
		expect(environment.has('PRIVATE_BETA_REQUIRE_INVITE')).toBe(false);
		expect(environment.get('PRIVATE_BETA_REQUIRE_STAFF_MFA')).toBe('true');
		expect(environment.get('LOCAL_AUTH_CAPTCHA_TEST_KEY')).toBe('');
	});
});
