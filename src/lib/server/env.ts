import { env as privateEnvironment } from '$env/dynamic/private';
import { env as publicEnvironment } from '$env/dynamic/public';

export interface RuntimeEnvironmentSource {
	[key: string]: string | undefined;
}

export type AppEnvironment = 'development' | 'staging' | 'production';

export interface DemoRuntimeConfiguration {
	mode: 'demo';
	demoMode: true;
	appEnvironment: AppEnvironment;
	publicAppUrl?: string;
	publicTurnstileSiteKey?: string;
}

export interface ProductionRuntimeConfiguration {
	mode: 'production';
	demoMode: false;
	appEnvironment: AppEnvironment;
	publicSupabaseUrl: string;
	publicSupabaseKey: string;
	/** @deprecated Legacy alias retained for existing server modules. */
	publicSupabaseAnonKey: string;
	expectedSupabaseProjectRef?: string;
	supabaseSecretKey?: string;
	imageProcessorMode: 'disabled' | 'cloudflare-images';
	publicAppUrl?: string;
	publicTurnstileSiteKey?: string;
	turnstileSecretKey?: string;
	turnstileExpectedHostname?: string;
}

export type RuntimeConfiguration = DemoRuntimeConfiguration | ProductionRuntimeConfiguration;

export class RuntimeConfigurationError extends Error {
	readonly code = 'runtime_configuration_error';

	constructor(readonly missingVariables: readonly string[], message?: string) {
		super(message ?? `Missing required runtime configuration: ${missingVariables.join(', ')}`);
		this.name = 'RuntimeConfigurationError';
	}
}

function firstRawValue(
	key: string,
	platformEnvironment?: RuntimeEnvironmentSource
): string | undefined {
	return (
		platformEnvironment?.[key] ??
		(publicEnvironment as RuntimeEnvironmentSource)[key] ??
		(privateEnvironment as RuntimeEnvironmentSource)[key]
	);
}

function firstValue(
	key: string,
	platformEnvironment?: RuntimeEnvironmentSource
): string | undefined {
	const value = firstRawValue(key, platformEnvironment);
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstValueForKeys(
	keys: readonly string[],
	platformEnvironment?: RuntimeEnvironmentSource
): string | undefined {
	for (const key of keys) {
		const value = platformEnvironment?.[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}

	for (const key of keys) {
		const value =
			(publicEnvironment as RuntimeEnvironmentSource)[key] ??
			(privateEnvironment as RuntimeEnvironmentSource)[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}

	return undefined;
}

function optionalHttpUrl(value: string | undefined, key: string): string | undefined {
	if (!value) return undefined;

	try {
		const url = new URL(value);
		const isLocalHttp =
			url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
		if (url.protocol !== 'https:' && !isLocalHttp) {
			throw new Error('must use HTTPS outside local development');
		}
		if (url.username || url.password) throw new Error('must not contain credentials');
		if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
			throw new Error('must be an origin without a path, query, or fragment');
		}
		return url.origin;
	} catch (cause) {
		throw new RuntimeConfigurationError(
			[key],
			`Invalid ${key}: ${cause instanceof Error ? cause.message : 'invalid URL'}`
		);
	}
}

function imageProcessorMode(
	platformEnvironment?: RuntimeEnvironmentSource
): ProductionRuntimeConfiguration['imageProcessorMode'] {
	const value = firstValue('IMAGE_PROCESSOR_MODE', platformEnvironment) ?? 'disabled';
	if (value === 'disabled' || value === 'cloudflare-images') return value;
	throw new RuntimeConfigurationError(
		['IMAGE_PROCESSOR_MODE'],
		'Invalid IMAGE_PROCESSOR_MODE: expected "disabled" or "cloudflare-images".'
	);
}

function appEnvironment(platformEnvironment?: RuntimeEnvironmentSource): AppEnvironment {
	const value = firstValue('APP_ENV', platformEnvironment) ?? 'development';
	if (value === 'development' || value === 'staging' || value === 'production') return value;
	throw new RuntimeConfigurationError(
		['APP_ENV'],
		'Invalid APP_ENV: expected "development", "staging", or "production".'
	);
}

/**
 * Runtime bindings take precedence over build-time values so this works with Cloudflare bindings.
 * Demo mode is deliberately strict: values such as "1", "yes", or a missing variable never enable it.
 */
export function getRuntimeConfiguration(
	platformEnvironment?: RuntimeEnvironmentSource
): RuntimeConfiguration {
	const demoModeValue = firstRawValue('PUBLIC_DEMO_MODE', platformEnvironment);
	if (demoModeValue !== undefined && demoModeValue !== 'true' && demoModeValue !== 'false') {
		throw new RuntimeConfigurationError(
			['PUBLIC_DEMO_MODE'],
			'Invalid PUBLIC_DEMO_MODE: expected "true" or "false".'
		);
	}
	const demoMode = demoModeValue === 'true';
	const configuredAppEnvironment = appEnvironment(platformEnvironment);
	const publicAppUrl = optionalHttpUrl(
		firstValue('PUBLIC_APP_URL', platformEnvironment),
		'PUBLIC_APP_URL'
	);
	const publicTurnstileSiteKey = firstValue(
		'PUBLIC_TURNSTILE_SITE_KEY',
		platformEnvironment
	);

	if (demoMode) {
		if (configuredAppEnvironment !== 'development') {
			throw new RuntimeConfigurationError(
				['PUBLIC_DEMO_MODE'],
				'PUBLIC_DEMO_MODE=true is allowed only when APP_ENV=development.'
			);
		}
		return {
			mode: 'demo',
			demoMode: true,
			appEnvironment: configuredAppEnvironment,
			publicAppUrl,
			publicTurnstileSiteKey
		};
	}

	const publicSupabaseUrl = optionalHttpUrl(
		firstValue('PUBLIC_SUPABASE_URL', platformEnvironment),
		'PUBLIC_SUPABASE_URL'
	);
	const publicSupabaseKey = firstValueForKeys(
		['PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_SUPABASE_ANON_KEY'],
		platformEnvironment
	);
	const expectedSupabaseProjectRef = firstValue(
		'EXPECTED_SUPABASE_PROJECT_REF',
		platformEnvironment
	);
	const missingVariables: string[] = [];
	if (!publicSupabaseUrl) missingVariables.push('PUBLIC_SUPABASE_URL');
	if (!publicSupabaseKey) {
		missingVariables.push('PUBLIC_SUPABASE_PUBLISHABLE_KEY or PUBLIC_SUPABASE_ANON_KEY');
	}
	if (configuredAppEnvironment === 'staging' && !expectedSupabaseProjectRef) {
		missingVariables.push('EXPECTED_SUPABASE_PROJECT_REF');
	}
	if (missingVariables.length > 0) throw new RuntimeConfigurationError(missingVariables);
	if (!publicSupabaseUrl || !publicSupabaseKey) {
		// The explicit narrowing keeps the returned production configuration non-optional.
		throw new RuntimeConfigurationError([
			'PUBLIC_SUPABASE_URL',
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY or PUBLIC_SUPABASE_ANON_KEY'
		]);
	}
	if (expectedSupabaseProjectRef && !/^[a-z]{20}$/u.test(expectedSupabaseProjectRef)) {
		throw new RuntimeConfigurationError(
			['EXPECTED_SUPABASE_PROJECT_REF'],
			'Invalid EXPECTED_SUPABASE_PROJECT_REF: expected exactly 20 lowercase letters.'
		);
	}

	return {
		mode: 'production',
		demoMode: false,
		appEnvironment: configuredAppEnvironment,
		publicSupabaseUrl,
		publicSupabaseKey,
		publicSupabaseAnonKey: publicSupabaseKey,
		expectedSupabaseProjectRef,
		supabaseSecretKey: firstValueForKeys(
			['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
			platformEnvironment
		),
		imageProcessorMode: imageProcessorMode(platformEnvironment),
		publicAppUrl,
		publicTurnstileSiteKey,
		turnstileSecretKey: firstValue('TURNSTILE_SECRET_KEY', platformEnvironment),
		turnstileExpectedHostname: firstValue('TURNSTILE_EXPECTED_HOSTNAME', platformEnvironment)
	};
}

export function getPlatformEnvironment(platform: App.Platform | undefined): RuntimeEnvironmentSource {
	return (platform?.env ?? {}) as RuntimeEnvironmentSource;
}
