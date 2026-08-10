import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
    env: {
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'ambient-publishable-key'
    }
}));

vi.mock('$env/dynamic/private', () => ({
    env: {
        SUPABASE_SECRET_KEY: 'ambient-secret-key'
    }
}));

import { getRuntimeConfiguration } from '../../src/lib/server/env';

describe('runtime environment precedence', () => {
    it('prefers runtime legacy Supabase keys over ambient primary aliases', () => {
        const runtime = getRuntimeConfiguration({
            PUBLIC_DEMO_MODE: 'false',
            PUBLIC_SUPABASE_URL: 'https://legacy.supabase.co',
            PUBLIC_SUPABASE_ANON_KEY: 'runtime-legacy-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'runtime-legacy-service-key'
        });

        expect(runtime).toMatchObject({
            publicSupabaseKey: 'runtime-legacy-anon-key',
            supabaseSecretKey: 'runtime-legacy-service-key'
        });
    });
});