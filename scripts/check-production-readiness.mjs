import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const envArgument = process.argv.find((argument) => argument.startsWith('--env-file='));
const envPath = resolve(workspace, envArgument?.slice('--env-file='.length) || '.env.production');

function parseEnvironment(contents) {
  const result = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

const fileEnvironment = existsSync(envPath)
  ? parseEnvironment(readFileSync(envPath, 'utf8'))
  : {};
const environment = { ...fileEnvironment, ...process.env };
const failures = [];
const wranglerPath = resolve(workspace, 'wrangler.jsonc');

function readWranglerConfiguration() {
  if (!existsSync(wranglerPath)) {
    failures.push('missing Cloudflare configuration: wrangler.jsonc');
    return null;
  }

  try {
    return JSON.parse(readFileSync(wranglerPath, 'utf8'));
  } catch {
    failures.push('wrangler.jsonc must contain valid JSON for release validation');
    return null;
  }
}

function requireValue(key) {
  const value = environment[key]?.trim();
  if (!value) failures.push(`${key} is required`);
  return value;
}

function requireMinBytes(key, minimum) {
  const value = requireValue(key);
  if (value && Buffer.byteLength(value, 'utf8') < minimum) {
    failures.push(`${key} must contain at least ${minimum} bytes`);
  }
}

function requireExact(key, expected) {
  const value = environment[key]?.trim();
  if (value !== expected) failures.push(`${key} must be ${expected}`);
}

function requireHttps(key) {
  const value = requireValue(key);
  if (!value) return;
  try {
    if (new URL(value).protocol !== 'https:') failures.push(`${key} must use HTTPS`);
  } catch {
    failures.push(`${key} must be a valid URL`);
  }
}

function requireCustomDomain(key) {
  const value = environment[key]?.trim();
  if (!value) return;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.endsWith('.workers.dev') || hostname === 'localhost' || hostname === '127.0.0.1') {
      failures.push(`${key} must use the approved custom production domain`);
    }
  } catch {
    // URL validity is reported by requireHttps.
  }
}

requireExact('APP_ENV', 'production');
requireExact('PUBLIC_DEMO_MODE', 'false');
requireExact('PRIVATE_BETA_REQUIRE_INVITE', 'true');
requireExact('PRIVATE_BETA_REQUIRE_STAFF_MFA', 'true');
requireExact('LEGAL_CONTENT_APPROVED', 'true');
requireExact('PAYMENT_PROVIDER', 'disabled');

for (const flag of [
  'FEATURE_BILLING_ENABLED',
  'FEATURE_LISTING_FEES_ENABLED',
  'FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED',
  'FEATURE_BOOSTS_ENABLED',
  'FEATURE_DIRECT_ADS_ENABLED',
  'FEATURE_MYPOS_PAYMENTS_ENABLED',
  'FEATURE_STRIPE_FALLBACK_ENABLED'
]) {
  requireExact(flag, 'false');
}

const wrangler = readWranglerConfiguration();
if (wrangler) {
  const workerFirstRoutes = wrangler.assets?.run_worker_first;
  if (
    !Array.isArray(workerFirstRoutes) ||
    !workerFirstRoutes.includes('/robots.txt') ||
    !workerFirstRoutes.includes('/sitemap.xml')
  ) {
    failures.push(
      'wrangler assets.run_worker_first must route /robots.txt and /sitemap.xml through the Worker'
    );
  }

  if (wrangler.workers_dev !== false) {
    failures.push('production workers_dev must be false');
  }

  if (wrangler.images?.binding !== 'IMAGES') {
    failures.push('production Cloudflare Images binding must be IMAGES');
  }

  if (wrangler.env?.staging?.workers_dev !== true) {
    failures.push('staging workers_dev must remain true');
  }

  if (wrangler.env?.staging?.images?.binding !== 'IMAGES') {
    failures.push('staging Cloudflare Images binding must be repeated as IMAGES');
  }
}

if (existsSync(resolve(workspace, 'static', 'robots.txt'))) {
  failures.push('static/robots.txt must not bypass the Worker crawler policy');
}

requireExact('FEATURE_SMS_VERIFICATION_ENABLED', 'true');
requireExact('IMAGE_PROCESSOR_MODE', 'cloudflare-images');
requireHttps('PUBLIC_APP_URL');
requireCustomDomain('PUBLIC_APP_URL');
requireHttps('PUBLIC_SUPABASE_URL');

for (const key of [
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TERMS_VERSION',
  'PRIVACY_VERSION',
  'MARKETPLACE_RULES_VERSION',
  'INCIDENT_CONTACT_EMAIL',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'TURNSTILE_SECRET_KEY',
  'PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_EXPECTED_HOSTNAME',
  'SUPABASE_AUTH_SMS_TWILIO_ACCOUNT_SID',
  'SUPABASE_AUTH_SMS_TWILIO_MESSAGE_SERVICE_SID',
  'SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_IMAGES_API_TOKEN'
]) {
  requireValue(key);
}

for (const key of ['NOTIFICATION_WEBHOOK_SECRET', 'UPLOAD_CLEANUP_SECRET']) {
  requireMinBytes(key, 32);
}

for (const migration of [
  '202607220003_beta_access_privacy.sql',
  '202607220004_workflow_invariants.sql',
  '202607220005_uploads_evidence.sql',
  '202607220006_moderation_lifecycle.sql',
  '202607220007_search_realtime_jobs.sql'
]) {
  if (!existsSync(resolve(workspace, 'supabase', 'migrations', migration))) {
    failures.push(`missing migration: ${migration}`);
  }
}

for (const route of [
  'src/routes/legal/terms/+page.svelte',
  'src/routes/legal/privacy/+page.svelte',
  'src/routes/legal/rules/+page.svelte',
  'src/routes/legal/appeals/+page.svelte',
  'src/routes/safety/+page.svelte'
]) {
  if (!existsSync(resolve(workspace, route))) failures.push(`missing launch document route: ${route}`);
}

if (!existsSync(resolve(workspace, 'supabase/functions/notification-email/index.ts'))) {
  failures.push('missing transactional notification email function');
}

if (!existsSync(resolve(workspace, 'supabase/functions/upload-cleanup/index.ts'))) {
  failures.push('missing private Storage cleanup function');
}

const appOrigin = environment.PUBLIC_APP_URL?.trim();
const turnstileHostname = environment.TURNSTILE_EXPECTED_HOSTNAME?.trim()?.toLowerCase();
if (appOrigin && turnstileHostname) {
  try {
    if (new URL(appOrigin).hostname.toLowerCase() !== turnstileHostname) {
      failures.push('TURNSTILE_EXPECTED_HOSTNAME must match PUBLIC_APP_URL');
    }
  } catch {
    // PUBLIC_APP_URL validity is reported by requireHttps.
  }
}

if (failures.length > 0) {
  console.error(`Production readiness failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production readiness checks passed using ${envPath}`);
