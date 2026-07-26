import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { RuntimeConfiguration } from '$lib/server/env';
import type {
  AuthProfile,
  AuthenticatorAssuranceLevel,
  BetaAccess
} from '$lib/server/auth/types';

declare global {
  namespace App {
    interface Error {
      message: string;
      requestId?: string;
    }

    interface Locals {
      requestId: string;
      runtime: RuntimeConfiguration;
      supabase: SupabaseClient | null;
      safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
      user: User | null;
      userId?: string;
      profile: AuthProfile | null;
      betaAccess: BetaAccess | null;
      currentAal: AuthenticatorAssuranceLevel | null;
      nextAal: AuthenticatorAssuranceLevel | null;
    }

    interface Platform {
      env?: Record<string, string | undefined>;
      context?: ExecutionContext;
      caches?: CacheStorage & { default: Cache };
    }
  }
}

export {};
