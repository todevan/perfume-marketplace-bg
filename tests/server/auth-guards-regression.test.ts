import { describe, it, expect, vi } from 'vitest';
import { routeAccessPolicy, requireBetaAccess, requireMfa, requireRole, enforceRoutePolicy } from '../../src/lib/server/auth/guards';
import { loadRequestAuthContext, AuthContextError } from '../../src/lib/server/auth/context';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { RequestAuthContext } from '../../src/lib/server/auth/types';

describe('routeAccessPolicy and guards regression matrix', () => {
  it('classifies known public routes', () => {
    expect(routeAccessPolicy('/login')).toBe('public');
    expect(routeAccessPolicy('/legal/terms')).toBe('public');
  });

  it('classifies authenticated and beta and staff routes', () => {
    expect(routeAccessPolicy('/onboarding')).toBe('authenticated');
    expect(routeAccessPolicy('/admin/dashboard')).toBe('staff');
    expect(routeAccessPolicy('/')).toBe('beta');
    expect(routeAccessPolicy('/auth/mfa')).toBe('staff-aal1');
  });

  it('enforceRoutePolicy allows public routes without throwing', () => {
    const ctx: RequestAuthContext = { user: null, profile: null, betaAccess: null, currentAal: null, nextAal: null };
    expect(() => enforceRoutePolicy(ctx, new URL('https://market.example/login'))).not.toThrow();
  });

  it('enforceRoutePolicy redirects anonymous on authenticated routes', () => {
    const ctx: RequestAuthContext = { user: null, profile: null, betaAccess: null, currentAal: null, nextAal: null };
    expect(() => enforceRoutePolicy(ctx, new URL('https://market.example/onboarding'))).toThrow();
  });

  it('enforceRoutePolicy rejects suspended or revoked beta users', () => {
    const ctxSuspended: RequestAuthContext = {
      user: { id: 'u1' } as User,
      profile: { id: 'u1', username: 'u', city: null, bio: null, avatarPath: null, accountKind: 'private', role: 'user', emailVerifiedAt: null, phoneVerifiedAt: null, merchantVerifiedAt: null, isSuspended: true },
      betaAccess: { profileId: 'u1', status: 'active', onboardingCompletedAt: '2026-07-22T10:00:00Z', activatedAt: null, expiresAt: null, hasCurrentConsents: true, isActive: true },
      currentAal: null,
      nextAal: null
    };
    expect(() => enforceRoutePolicy(ctxSuspended, new URL('https://market.example/listings'))).toThrow();

    const ctxRevoked: RequestAuthContext = {
      ...ctxSuspended,
      profile: { ...ctxSuspended.profile!, isSuspended: false },
      betaAccess: { ...ctxSuspended.betaAccess!, status: 'revoked', isActive: false }
    };
    expect(() => enforceRoutePolicy(ctxRevoked, new URL('https://market.example/listings'))).toThrow();
  });

  it('staff-aal1 requires role but not AAL', () => {
    const anon: RequestAuthContext = { user: null, profile: null, betaAccess: null, currentAal: null, nextAal: null };
    expect(() => enforceRoutePolicy(anon, new URL('https://market.example/auth/mfa'))).toThrow();

    const nonStaff: RequestAuthContext = {
      user: { id: 'u1' } as User,
      profile: { id: 'u1', username: 'u', city: null, bio: null, avatarPath: null, accountKind: 'private', role: 'user', emailVerifiedAt: '2026-07-22T09:00:00Z', phoneVerifiedAt: null, merchantVerifiedAt: null, isSuspended: false },
      betaAccess: { profileId: 'u1', status: 'active', onboardingCompletedAt: '2026-07-22T10:00:00Z', activatedAt: null, expiresAt: null, hasCurrentConsents: true, isActive: true },
      currentAal: null,
      nextAal: null
    };
    expect(() => enforceRoutePolicy(nonStaff, new URL('https://market.example/auth/mfa'))).toThrow();

    const staff: RequestAuthContext = { ...nonStaff, profile: { ...nonStaff.profile!, role: 'moderator' } };
    expect(() => enforceRoutePolicy(staff, new URL('https://market.example/auth/mfa'))).not.toThrow();
  });

  it('staff requires role and aal2', () => {
    const nonStaff: RequestAuthContext = {
      user: { id: 'u1' } as User,
      profile: { id: 'u1', username: 'u', city: null, bio: null, avatarPath: null, accountKind: 'private', role: 'user', emailVerifiedAt: '2026-07-22T09:00:00Z', phoneVerifiedAt: null, merchantVerifiedAt: null, isSuspended: false },
      betaAccess: { profileId: 'u1', status: 'active', onboardingCompletedAt: '2026-07-22T10:00:00Z', activatedAt: null, expiresAt: null, hasCurrentConsents: true, isActive: true },
      currentAal: null,
      nextAal: null
    };
    expect(() => enforceRoutePolicy(nonStaff, new URL('https://market.example/admin/dashboard'))).toThrow();

    const staffWrongAal: RequestAuthContext = { ...nonStaff, profile: { ...nonStaff.profile!, role: 'admin' }, currentAal: 'aal1' };
    expect(() => enforceRoutePolicy(staffWrongAal, new URL('https://market.example/admin/dashboard'))).toThrow();

    const staffOk: RequestAuthContext = { ...nonStaff, profile: { ...nonStaff.profile!, role: 'admin' }, currentAal: 'aal2' };
    expect(() => enforceRoutePolicy(staffOk, new URL('https://market.example/admin/dashboard'))).not.toThrow();
  });
});


describe('loadRequestAuthContext call counts and failure modes', () => {
  it('calls only getUser when anonymous', async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        mfa: { getAuthenticatorAssuranceLevel: vi.fn() }
      },
      from: vi.fn(),
      rpc: vi.fn()
    } as unknown as SupabaseClient;

    const ctx = await loadRequestAuthContext(client);
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect((client.auth.mfa.getAuthenticatorAssuranceLevel as any)).not.toHaveBeenCalled();
    expect(ctx.user).toBeNull();
  });

  it('calls getUser + profile + rpc + aal when user present', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null }));
    const getAal = vi.fn(async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }));
    const from = vi.fn(() => ({ select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', username: 'u' }, error: null }) }) }) }));
    const rpc = vi.fn(async () => ({ data: [{ profile_id: 'u1', membership_status: 'active', onboarding_completed_at: '2026-07-22T10:00:00Z', is_active: true }], error: null }));

    const client = {
      auth: { getUser, mfa: { getAuthenticatorAssuranceLevel: getAal } },
      from,
      rpc
    } as unknown as SupabaseClient;

    const ctx = await loadRequestAuthContext(client);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(getAal).toHaveBeenCalledTimes(1);
    expect(ctx.user?.id).toBe('u1');
    expect(ctx.profile?.id).toBe('u1');
    expect(ctx.betaAccess?.status).toBe('active');
  });

  it('throws AuthContextError when profile select errors', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('db') }) }) }) })),
      rpc: vi.fn(async () => ({ data: [], error: null }))
    } as unknown as SupabaseClient;

    await expect(loadRequestAuthContext(client)).rejects.toBeInstanceOf(AuthContextError);
  });

  it('throws AuthContextError when rpc errors', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: 'aal1' }, error: null })) } },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }) })),
      rpc: vi.fn(async () => ({ data: null, error: new Error('rpc') }))
    } as unknown as SupabaseClient;

    await expect(loadRequestAuthContext(client)).rejects.toBeInstanceOf(AuthContextError);
  });
});
