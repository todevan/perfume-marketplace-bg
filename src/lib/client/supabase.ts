import { env } from '$env/dynamic/public';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null | undefined;

/**
 * Returns no client only in explicitly enabled demo mode. Missing production values are an error,
 * which prevents the browser from silently switching to unauthenticated/demo behavior.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
	if (browserClient !== undefined) return browserClient;
	if (env.PUBLIC_DEMO_MODE === 'true') {
		browserClient = null;
		return browserClient;
	}

	const url = env.PUBLIC_SUPABASE_URL?.trim();
	const key =
		env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || env.PUBLIC_SUPABASE_ANON_KEY?.trim();
	if (!url || !key) {
		throw new Error('Supabase browser configuration is unavailable.');
	}

	browserClient = createBrowserClient(url, key, {
		auth: { flowType: 'pkce' },
		global: { headers: { 'X-Client-Info': 'perfume-marketplace-browser' } }
	});
	return browserClient;
}

export function resetSupabaseBrowserClientForTests(): void {
	browserClient = undefined;
}
