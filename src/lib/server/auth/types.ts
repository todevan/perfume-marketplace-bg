import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AccountKind = 'private' | 'merchant';
export type PlatformRole = 'user' | 'moderator' | 'admin';
export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2';
export type BetaMembershipStatus = 'pending' | 'active' | 'suspended' | 'revoked';

export interface AuthProfile {
	id: string;
	username: string;
	city: string | null;
	bio: string | null;
	avatarPath: string | null;
	accountKind: AccountKind;
	role: PlatformRole;
	emailVerifiedAt: string | null;
	phoneVerifiedAt: string | null;
	merchantVerifiedAt: string | null;
	isSuspended: boolean;
}

export interface BetaAccess {
	profileId: string;
	status: BetaMembershipStatus;
	onboardingCompletedAt: string | null;
	activatedAt: string | null;
	expiresAt: string | null;
	hasCurrentConsents: boolean;
	isActive: boolean;
}

export interface RequestAuthContext {
	user: User | null;
	profile: AuthProfile | null;
	betaAccess: BetaAccess | null;
	currentAal: AuthenticatorAssuranceLevel | null;
	nextAal: AuthenticatorAssuranceLevel | null;
}

export interface AuthenticatedBetaContext {
	user: User;
	profile: AuthProfile;
	betaAccess: BetaAccess;
}

export interface RequestLocalsAuthState extends RequestAuthContext {
	supabase: SupabaseClient | null;
}

export interface PublicAuthUser {
	id: string;
}

export interface PublicAuthState {
	user: PublicAuthUser | null;
	profile: AuthProfile | null;
	betaAccess: BetaAccess | null;
	currentAal: AuthenticatorAssuranceLevel | null;
}

export function toPublicAuthState(context: RequestAuthContext): PublicAuthState {
	return {
	user: context.user
			? {
					id: context.user.id
				}
			: null,
		profile: context.profile,
		betaAccess: context.betaAccess,
		currentAal: context.currentAal
	};
}
