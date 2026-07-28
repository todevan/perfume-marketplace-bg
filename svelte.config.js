import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';

function buildVersion() {
  const ciSha = process.env.GITHUB_SHA?.trim();
  if (ciSha && /^[0-9a-f]{40}$/i.test(ciSha)) return ciSha.toLowerCase();

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().toLowerCase();
  } catch {
    return 'unversioned-local-build';
  }
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    version: {
      name: buildVersion()
    },
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
