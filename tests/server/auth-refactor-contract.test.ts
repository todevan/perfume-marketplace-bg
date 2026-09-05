import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redirect } from '@sveltejs/kit';
import { loginRedirect, safeRedirectPath } from '../../src/lib/server/auth/redirect';
import { routeAccessPolicy, requireBetaAccess, requireMfa, enforceRoutePolicy } from '../../src/lib/server/auth/guards';
import { AuthContextError } from '../../src/lib/server/auth/context';

// Keep a mutable holder for the mock Supabase client used by createServerClient
let currentMockClient: any = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: any[]) => {
    return currentMockClient;
  }
}));

// Mock runtime configuration helpers used by hooks.server
vi.mock('../../src/lib/server/env', () => ({
  getPlatformEnvironment: (platform: any) => ({}),
  getRuntimeConfiguration: (env: any) => ({
    mode: 'development',
    publicSupabaseUrl: 'https://project.supabase.co',
    publicSupabaseKey: 'public-key',
    appEnvironment: 'development'
  })
}));

import { handle } from '../../src/hooks.server';

// Helper to build a minimal event object for hooks.handle
function makeEvent(pathname: string) {
  return {
    route: { id: pathname },
    url: new URL(`https://market.example${pathname}`),
    request: new Request(`https://market.example${pathname}`),
    platform: {},
    cookies: {
      getAll: () => [],
      set: () => {}
    },
    fetch: fetch,
    setHeaders: () => {},
    locals: {}
  } as any;
}

describe('exact redirect expectations for guards', () => {
  it('anonymous authenticated route -> 303 to loginRedirect', () => {
    const ctx = { user: null, profile: null, betaAccess: null, currentAal: null, nextAal: null } as any;
    try {
      enforceRoutePolicy(ctx, new URL('https://market.example/onboarding'));
      throw new Error('expected redirect');
    } catch (err: any) {
      // SvelteKit redirect throws an object with status and location
      expect(err.status).toBe(303);
      expect(err.location).toBe(loginRedirect(new URL('https://market.example/onboarding')));
    }
  });

  it('incomplete onboarding -> 303 to /onboarding?next=', () => {
    const ctx = { user: { id: 'u1' }, profile: null, betaAccess: null, currentAal: null, nextAal: null } as any;
    try {
      requireBetaAccess(ctx, new URL('https://market.example/some-private'));
      throw new Error('expected redirect');
    } catch (err: any) {
      expect(err.status).toBe(303);
      const expected = `/onboarding?next=${encodeURIComponent(safeRedirectPath('/some-private', '/'))}`;
      expect(err.location).toBe(expected);
    }
  });

  it('insufficient staff AAL -> 303 to /auth/mfa?next=', () => {
    const ctx = { user: { id: 'u1' }, profile: { role: 'admin' }, betaAccess: { status: 'active', isActive: true, onboardingCompletedAt: 'x' }, currentAal: 'aal1', nextAal: null } as any;
    try {
      requireMfa(ctx, new URL('https://market.example/admin/secure'));
      throw new Error('expected redirect');
    } catch (err: any) {
      expect(err.status).toBe(303);
      const next = encodeURIComponent('/admin/secure');
      expect(err.location).toBe(`/auth/mfa?next=${next}`);
    }
  });
});

// Hook-level and call-selection tests
describe('hook-level service failure and selective-call behavior (contract tests)', () => {
  beforeEach(() => {
    // reset mock client
    currentMockClient = null;
  });

  it('returns 503 when profile select fails (hook-level)', async () => {
    // Mock client that will cause profile select error
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('db') }) }) }) })),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u1', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/some-private');
    const response = await handle({ event, resolve: async () => new Response('ok') });

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toMatch(/Authentication service is unavailable/);
    expect(response.headers.get('content-security-policy')).toBeTruthy();
  });

  it('returns 503 when beta-access RPC fails (hook-level)', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: null, error: new Error('rpc') }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/some-private');
    const response = await handle({ event, resolve: async () => new Response('ok') });

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toMatch(/Authentication service is unavailable/);
    expect(response.headers.get('content-security-policy')).toBeTruthy();
  });

  // Selective-call tests: these define the desired post-refactor behavior and should fail initially
  it('onboarding loads its required profile and beta context without loading AAL', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u1', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/onboarding');

    const response = await handle({ event, resolve: async () => new Response('ok') });

    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it('authenticated-only route with no user -> profile/rpc/mfa not called (should pass)', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } },
      from: vi.fn(),
      rpc: vi.fn()
    } as any;
    currentMockClient = client;

    const event = makeEvent('/onboarding');

    const response = await handle({ event, resolve: async () => new Response('ok') });
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect((client.auth.mfa.getAuthenticatorAssuranceLevel as any)).not.toHaveBeenCalled();
  });

  it('password update loads beta context for an authenticated user without profile or AAL', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } },
      from: vi.fn(),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u1', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/auth/update-password');

    await handle({ event, resolve: async () => new Response('ok') });

    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledWith('get_my_beta_access');
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it('ordinary authenticated logout loads only the user', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn() } },
      from: vi.fn(),
      rpc: vi.fn()
    } as any;
    currentMockClient = client;

    const event = makeEvent('/auth/logout');

    await handle({ event, resolve: async () => new Response('ok') });

    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it('login loads beta context for an authenticated session without profile or AAL', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u1', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/login');

    const response = await handle({ event, resolve: async () => new Response('ok') });
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it('staff-aal1 MFA route loads profile, beta, and AAL for its route consumer', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u2' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u2' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u2', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/auth/mfa');

    const response = await handle({ event, resolve: async () => new Response('ok') });
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalled();
  });

  it('beta route -> profile & beta fetched, mfa NOT called (characterization should fail pre-refactor)', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u3' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u3' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u3', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/listings');

    const response = await handle({ event, resolve: async () => new Response('ok') });
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled(); // RED expected
  });

  it('staff route -> profile, beta and mfa fetched (should pass)', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u4' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal2' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u4' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: [{ profile_id: 'u4', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }))
    } as any;
    currentMockClient = client;

    const event = makeEvent('/admin/reports');

    const response = await handle({ event, resolve: async () => new Response('ok') });
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalled();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalled();
  });

  it.each(['/onboarding', '/auth/error'])(
    'preserves confirmation redirect privacy headers through the effective handle for %s',
    async (location) => {
      currentMockClient = {
        auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) }
      };

      const event = makeEvent('/auth/confirm');
      const response = await handle({
        event,
        resolve: async () =>
          new Response(null, {
            status: 303,
            headers: {
              location,
              'cache-control': 'private, no-store',
              'referrer-policy': 'no-referrer'
            }
          })
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(location);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  );
});

// These routes authenticate their own dedicated credential/signature, not browser sessions.
describe('operations provider routes do not depend on user Auth availability', () => {
  it.each([
    ['/api/operations/readiness', 'GET'],
    ['/api/webhooks/resend', 'POST']
  ])('reaches the exact %s boundary while user Auth is unavailable', async (path, method) => {
    currentMockClient = null;
    const event = makeEvent(path);
    event.request = new Request(event.url, { method });
    const response = await handle({ event, resolve: async () => new Response('boundary-denied', { status: 401 }) });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('boundary-denied');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toBeTruthy();
    expect(response.headers.get('x-deployed-git-sha')).toBeTruthy();
    expect(event.locals.user).toBeNull();
    expect(event.locals.supabase).toBeNull();
  });
});
