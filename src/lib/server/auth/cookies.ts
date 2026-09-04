import { clearAuthCookiesAtScopes } from '@supabase/ssr';
import type { Cookies } from '@sveltejs/kit';

export async function expireCurrentProjectAuthCookies(
	cookies: Cookies,
	publicSupabaseUrl: string
): Promise<void> {
	const projectRef = new URL(publicSupabaseUrl).hostname.split('.')[0];
	await clearAuthCookiesAtScopes({
		getAll: () => cookies.getAll(),
		setAll: async (cookiesToSet) => {
			let failed = false;
			for (const { name, value, options } of cookiesToSet) {
				try {
					cookies.delete(name, { path: '/' });
				} catch {
					try {
						cookies.set(name, value, { ...options, path: '/' });
					} catch {
						failed = true;
					}
				}
			}
			if (failed) throw new Error('auth cookie invalidation failed');
		},
		storageKey: `sb-${projectRef}-auth-token`,
		scopes: [{ path: '/' }]
	});
}
