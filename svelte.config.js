import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Vite preview is an ephemeral runtime. Persisted platform bindings share
    // SQLite state between build/preview processes and can deadlock Miniflare
    // in CI, while real local persistence remains available through Wrangler.
    adapter: adapter({
      platformProxy: {
        persist: false
      }
    }),
    alias: {
      $components: 'src/lib/components',
      $domain: 'src/lib/domain'
    }
  }
};

export default config;
