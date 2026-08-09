import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	AccountKind,
	AuthProfile,
	AuthenticatorAssuranceLevel,
	BetaAccess,
	BetaMembershipStatus,
	PlatformRole,
	RequestAuthContext
} from './types';

export class AuthContextError extends Error {
	readonly code = 'auth_context_unavailable';

	constructor(readonly operation: 'profile' | 'beta_access', options?: ErrorOptions) {
		super('The authenticated account context could not be loaded.', options);
		this.name = 'AuthContextError';
	}
}

type UnknownRow = Record<string, unknown>;

function nullableString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function requiredString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function normalizeProfile(row: UnknownRow, accessRow: UnknownRow): AuthProfile {
	return {
		id: requiredString(row.id, requiredString(accessRow.profile_id, '')),
		username: requiredString(accessRow.username, requiredString(row.username, '')),
		city: nullableString(row.city),
		bio: nullableString(row.bio),
		avatarPath: nullableString(row.avatar_path),
		accountKind: (accessRow.account_kind === 'merchant' ? 'merchant' : 'private') as AccountKind,
		role: (['moderator', 'admin'].includes(String(accessRow.role))
			? accessRow.role
			: 'user') as PlatformRole,
		emailVerifiedAt: nullableString(accessRow.email_verified_at),
		phoneVerifiedAt: nullableString(accessRow.phone_verified_at),
		merchantVerifiedAt: nullableString(accessRow.merchant_verified_at),
		isSuspended: accessRow.is_suspended === true
	};
}

function normalizeStatus(value: unknown): BetaMembershipStatus | null {
	return ['pending', 'active', 'suspended', 'revoked'].includes(String(value))
		? (value as BetaMembershipStatus)
		: null;
}


function normalizeBetaAccess(row: UnknownRow, userId: string): BetaAccess | null {
	const status = normalizeStatus(row.membership_status ?? row.status);
	if (!status) return null;
	return {
		profileId: requiredString(row.profile_id, userId),
		status,
		onboardingCompletedAt: nullableString(row.onboarding_completed_at),
		activatedAt: nullableString(row.activated_at),
		expiresAt: nullableString(row.membership_expires_at ?? row.expires_at),
		hasCurrentConsents: row.has_current_consents === true,
		isActive: row.is_active === true
	};
}

function firstRow(value: unknown): UnknownRow | null {
	if (Array.isArray(value)) return (value[0] as UnknownRow | undefined) ?? null;
	if (value && typeof value === 'object') return value as UnknownRow;
	return null;
}

/**
 * Uses getUser(), never cookie-only getSession(), before making authorization decisions.
 * The access RPC remains the authority for expiry, consent, suspension and onboarding state.
 */
export async function loadRequestAuthContext(client: SupabaseClient): Promise<RequestAuthContext> {
  // legacy full eager loader kept for rollback and external use
  const { data: userData, error: userError } = await client.auth.getUser();
  const user = userError ? null : userData.user;

  if (!user) {
    return { user: null, profile: null, betaAccess: null, currentAal: null, nextAal: null };
  }

  const [profileResult, accessResult, aalResult] = await Promise.all([
    client
      .from('profiles')
      .select('id, username, city, bio, avatar_path, account_kind')
      .eq('id', user.id)
      .maybeSingle(),
    client.rpc('get_my_beta_access'),
    client.auth.mfa.getAuthenticatorAssuranceLevel()
  ]);

  if (profileResult.error) {
    throw new AuthContextError('profile', { cause: profileResult.error });
  }
  if (accessResult.error) {
    throw new AuthContextError('beta_access', { cause: accessResult.error });
  }

  const accessRow = firstRow(accessResult.data);
  if (!accessRow) throw new AuthContextError('beta_access');
  return {
    user,
    profile: profileResult.data
      ? normalizeProfile(profileResult.data as UnknownRow, accessRow)
      : null,
    betaAccess: normalizeBetaAccess(accessRow, user.id),
    currentAal: aalResult.error
      ? null
      : ((aalResult.data.currentLevel as AuthenticatorAssuranceLevel | null) ?? null),
    nextAal: aalResult.error
      ? null
      : ((aalResult.data.nextLevel as AuthenticatorAssuranceLevel | null) ?? null)
  };
}

/**
 * Minimal context loader: only fetches the authenticated user via getUser().
 * Use this in hooks to avoid eager server-side work on public/authenticated routes.
 */
export async function loadMinimalAuthContext(client: SupabaseClient): Promise<Pick<RequestAuthContext, 'user'>> {
  const { data: userData, error: userError } = await client.auth.getUser();
  const user = userError ? null : userData.user;
  return { user };
}

/**
 * Fetch specific pieces of authenticated context on demand. Throws AuthContextError
 * when profile or beta_access RPC fail (preserves fail-closed semantics).
 */
export async function loadAuthPieces(
  client: SupabaseClient,
  opts: { needProfile?: boolean; needBetaAccess?: boolean; needAal?: boolean },
  userId: string
): Promise<Partial<RequestAuthContext>> {
  const { needProfile = false, needBetaAccess = false, needAal = false } = opts;

  const calls: Promise<any>[] = [];
  let profileResult: any = null;
  let accessResult: any = null;
  let aalResult: any = null;

  if (needProfile) {
    const p = Promise.resolve(
      client
        .from('profiles')
        .select('id, username, city, bio, avatar_path, account_kind')
        .eq('id', userId)
        .maybeSingle()
    );
    calls.push(p.then((r: any) => (profileResult = r)));
  }
  if (needBetaAccess) {
    const a = Promise.resolve(client.rpc('get_my_beta_access'));
    calls.push(a.then((r: any) => (accessResult = r)));
  }
  if (needAal) {
    const m = Promise.resolve(client.auth.mfa.getAuthenticatorAssuranceLevel());
    calls.push(m.then((r: any) => (aalResult = r)));
  }

  await Promise.all(calls);

  if (needProfile && profileResult?.error) {
    throw new AuthContextError('profile', { cause: profileResult.error });
  }
  if (needBetaAccess && accessResult?.error) {
    throw new AuthContextError('beta_access', { cause: accessResult.error });
  }

  const result: Partial<RequestAuthContext> = {};

  if (needProfile) {
    result.profile = profileResult?.data ? normalizeProfile(profileResult.data as UnknownRow, (accessResult?.data && firstRow(accessResult.data)) ?? {}) : null;
  }
  if (needBetaAccess) {
    const accessRow = firstRow(accessResult.data);
    if (!accessRow) throw new AuthContextError('beta_access');
    result.betaAccess = normalizeBetaAccess(accessRow, userId);
  }
  if (needAal) {
    result.currentAal = aalResult?.error ? null : ((aalResult.data.currentLevel as AuthenticatorAssuranceLevel | null) ?? null);
    result.nextAal = aalResult?.error ? null : ((aalResult.data.nextLevel as AuthenticatorAssuranceLevel | null) ?? null);
  }

  return result;
}