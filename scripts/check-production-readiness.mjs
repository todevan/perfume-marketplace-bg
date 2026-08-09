import { createHash } from 'node:crypto';
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
const maximumReceiptAgeMs = 24 * 60 * 60 * 1000;
const maximumReceiptClockSkewMs = 5 * 60 * 1000;
const expectedHostedRuntimeInventory = {
  realtimeTables: [
    'beta_memberships',
    'deal_confirmations',
    'listing_photos',
    'listings',
    'offers',
    'reports',
    'upload_quarantine'
  ],
  scheduledJobs: [
    {
      active: true,
      command: 'select private.queue_listing_expiry_notifications(500)',
      name: 'perfume-beta-expiry-notifications',
      schedule: '15 8 * * *'
    },
    {
      active: true,
      command: 'select private.run_beta_maintenance(500)',
      name: 'perfume-beta-maintenance',
      schedule: '*/5 * * * *'
    }
  ]
};
const requiredProviderChecks = [
  'cloudflareImages',
  'notificationWebhook',
  'resendEmail',
  'supabaseAuth',
  'turnstile',
  'uploadCleanup'
];

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

function requireCanonicalHttpsOrigin(key) {
  const value = requireValue(key);
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      failures.push(`${key} must be a credential-free canonical HTTPS origin`);
    }
  } catch {
    failures.push(`${key} must be a valid URL`);
  }
}

function requireSha256(key) {
  const value = requireValue(key);
  if (value && !/^[a-f0-9]{64}$/iu.test(value)) failures.push(`${key} must be a SHA-256 receipt`);
  return value;
}

function rejectPlaceholder(key) {
  const value = environment[key]?.trim() ?? '';
  if (/\[|\]|example|placeholder|changeme|todo|pending/i.test(value)) {
    failures.push(`${key} must not contain a placeholder value`);
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

requireExact('IMAGE_PROCESSOR_MODE', 'cloudflare-images');
requireCanonicalHttpsOrigin('PUBLIC_APP_URL');
requireCustomDomain('PUBLIC_APP_URL');
requireCanonicalHttpsOrigin('PUBLIC_SUPABASE_URL');

const expectedProductionHost = requireValue('EXPECTED_PRODUCTION_APP_HOST')?.toLowerCase();
const expectedSupabaseRef = requireValue('EXPECTED_SUPABASE_PROJECT_REF')?.toLowerCase();
const releaseCommitSha = requireValue('RELEASE_COMMIT_SHA')?.toLowerCase();
if (releaseCommitSha && !/^[a-f0-9]{40}$/u.test(releaseCommitSha)) {
  failures.push('RELEASE_COMMIT_SHA must be the exact 40-character Git commit');
}
try {
  if (
    expectedProductionHost &&
    new URL(environment.PUBLIC_APP_URL ?? '').hostname.toLowerCase() !== expectedProductionHost
  ) failures.push('PUBLIC_APP_URL does not match EXPECTED_PRODUCTION_APP_HOST');
  if (
    expectedSupabaseRef &&
    new URL(environment.PUBLIC_SUPABASE_URL ?? '').hostname.toLowerCase() !==
      `${expectedSupabaseRef}.supabase.co`
  ) failures.push('PUBLIC_SUPABASE_URL does not match EXPECTED_SUPABASE_PROJECT_REF');
} catch {
  // Canonical URL failures are reported above.
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function requirePattern(key, pattern, description) {
  const value = environment[key]?.trim();
  if (value && !pattern.test(value)) failures.push(`${key} ${description}`);
}

function requireEmailAddress(key) {
  const value = environment[key]?.trim();
  if (!value) return;
  const address = value.match(/<([^<>]+)>$/u)?.[1] ?? value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) {
    failures.push(`${key} must contain a valid email address`);
  }
}

function requireFreshTimestamp(value, label) {
  if (typeof value !== 'string') {
    failures.push(`${label} must contain an ISO timestamp`);
    return;
  }
  const timestamp = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(timestamp)) {
    failures.push(`${label} must contain an ISO timestamp`);
  } else if (timestamp > now + maximumReceiptClockSkewMs) {
    failures.push(`${label} is dated too far in the future`);
  } else if (timestamp < now - maximumReceiptAgeMs) {
    failures.push(`${label} is older than 24 hours`);
  }
}

function readReceipt(pathKey, shaKey) {
  const configuredPath = requireValue(pathKey);
  const expectedSha = requireSha256(shaKey);
  if (!configuredPath || !expectedSha) return null;

  const receiptPath = resolve(workspace, configuredPath);
  if (!existsSync(receiptPath)) {
    failures.push(`${pathKey} does not point to an existing receipt`);
    return null;
  }

  const contents = readFileSync(receiptPath);
  const actualSha = createHash('sha256').update(contents).digest('hex');
  if (actualSha !== expectedSha.toLowerCase()) {
    failures.push(`${shaKey} does not match the exact receipt bytes`);
    return null;
  }

  try {
    const receipt = JSON.parse(contents.toString('utf8'));
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      failures.push(`${pathKey} must contain a JSON object`);
      return null;
    }
    return receipt;
  } catch {
    failures.push(`${pathKey} must contain valid JSON`);
    return null;
  }
}

for (const key of [
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TERMS_VERSION',
  'PRIVACY_VERSION',
  'MARKETPLACE_RULES_VERSION',
  'INCIDENT_CONTACT_EMAIL',
  'LEGAL_CONTROLLER_NAME',
  'LEGAL_CONTROLLER_REGISTRATION',
  'LEGAL_CONTROLLER_ADDRESS',
  'PRIVACY_CONTACT_EMAIL',
  'APPEALS_CONTACT_EMAIL',
  'LEGAL_APPROVAL_REFERENCE',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'TURNSTILE_SECRET_KEY',
  'PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_EXPECTED_HOSTNAME',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_IMAGES_API_TOKEN'
]) {
  requireValue(key);
}
for (const key of [
  'INCIDENT_CONTACT_EMAIL',
  'LEGAL_CONTROLLER_NAME',
  'LEGAL_CONTROLLER_REGISTRATION',
  'LEGAL_CONTROLLER_ADDRESS',
  'PRIVACY_CONTACT_EMAIL',
  'APPEALS_CONTACT_EMAIL',
  'LEGAL_APPROVAL_REFERENCE',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY'
]) rejectPlaceholder(key);

requirePattern(
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  /^sb_publishable_[A-Za-z0-9_-]{12,}$/u,
  'must be a production publishable-key shape'
);
const supabaseSecretKey = environment.SUPABASE_SECRET_KEY?.trim() ?? '';
if (
  supabaseSecretKey &&
  !/^sb_secret_[A-Za-z0-9_-]{12,}$/u.test(supabaseSecretKey) &&
  !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(supabaseSecretKey)
) {
  failures.push('SUPABASE_SECRET_KEY must be a secret-key or service-role JWT shape');
}
if (
  supabaseSecretKey &&
  supabaseSecretKey === environment.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
) {
  failures.push('SUPABASE_SECRET_KEY must not equal PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}
requirePattern('RESEND_API_KEY', /^re_[A-Za-z0-9_-]{8,}$/u, 'must be a Resend API-key shape');
requireMinBytes('TURNSTILE_SECRET_KEY', 20);
requireMinBytes('PUBLIC_TURNSTILE_SITE_KEY', 20);
requirePattern(
  'CLOUDFLARE_ACCOUNT_ID',
  /^[a-f0-9]{32}$/iu,
  'must be a 32-character Cloudflare account ID'
);
requireMinBytes('CLOUDFLARE_IMAGES_API_TOKEN', 20);
for (const key of [
  'INCIDENT_CONTACT_EMAIL',
  'PRIVACY_CONTACT_EMAIL',
  'APPEALS_CONTACT_EMAIL',
  'RESEND_FROM_EMAIL'
]) {
  requireEmailAddress(key);
}

const hostedRuntimeReceipt = readReceipt(
  'HOSTED_RUNTIME_INVENTORY_RECEIPT_PATH',
  'HOSTED_CRON_INVENTORY_SHA256'
);
const providerReceipt = readReceipt(
  'PROVIDER_ATTESTATION_RECEIPT_PATH',
  'PROVIDER_ATTESTATION_SHA256'
);

if (hostedRuntimeReceipt) {
  if (
    hostedRuntimeReceipt.schemaVersion !== 1 ||
    hostedRuntimeReceipt.kind !== 'hosted-runtime-inventory'
  ) {
    failures.push('hosted runtime receipt has an unsupported schema');
  }
  requireFreshTimestamp(hostedRuntimeReceipt.checkedAt, 'hosted runtime receipt');
  if (hostedRuntimeReceipt.projectRef !== expectedSupabaseRef) {
    failures.push('hosted runtime receipt projectRef does not match the release target');
  }
  if (hostedRuntimeReceipt.commitSha !== releaseCommitSha) {
    failures.push('hosted runtime receipt commitSha does not match RELEASE_COMMIT_SHA');
  }
  if (
    JSON.stringify(canonicalize(hostedRuntimeReceipt.inventory)) !==
    JSON.stringify(canonicalize(expectedHostedRuntimeInventory))
  ) {
    failures.push('hosted runtime receipt does not contain the exact required jobs and Realtime tables');
  }
}

if (providerReceipt) {
  if (
    providerReceipt.schemaVersion !== 1 ||
    providerReceipt.kind !== 'production-provider-attestation'
  ) {
    failures.push('provider attestation receipt has an unsupported schema');
  }
  requireFreshTimestamp(providerReceipt.checkedAt, 'provider attestation receipt');
  if (providerReceipt.productionAppHost !== expectedProductionHost) {
    failures.push('provider attestation productionAppHost does not match the release target');
  }
  if (providerReceipt.supabaseProjectRef !== expectedSupabaseRef) {
    failures.push('provider attestation supabaseProjectRef does not match the release target');
  }
  if (providerReceipt.cloudflareAccountId !== environment.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    failures.push('provider attestation cloudflareAccountId does not match the configured account');
  }
  if (providerReceipt.commitSha !== releaseCommitSha) {
    failures.push('provider attestation commitSha does not match RELEASE_COMMIT_SHA');
  }
  if (
    !providerReceipt.checks ||
    typeof providerReceipt.checks !== 'object' ||
    Array.isArray(providerReceipt.checks)
  ) {
    failures.push('provider attestation must contain explicit provider checks');
  } else {
    const actualCheckNames = Object.keys(providerReceipt.checks).sort();
    if (JSON.stringify(actualCheckNames) !== JSON.stringify(requiredProviderChecks)) {
      failures.push('provider attestation must contain exactly the required provider checks');
    }
    for (const check of requiredProviderChecks) {
      const result = providerReceipt.checks[check];
      if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result) ||
        result.passed !== true
      ) {
        failures.push(`provider attestation check ${check} must be a passing result`);
        continue;
      }
      if (
        JSON.stringify(Object.keys(result).sort()) !==
        JSON.stringify(['checkedAt', 'evidenceSha256', 'passed'])
      ) {
        failures.push(`provider attestation check ${check} contains unsupported fields`);
      }
      requireFreshTimestamp(result.checkedAt, `provider attestation check ${check}`);
      if (!/^[a-f0-9]{64}$/iu.test(result.evidenceSha256 ?? '')) {
        failures.push(`provider attestation check ${check} must include an evidence SHA-256`);
      }
    }
  }
}

for (const key of ['NOTIFICATION_WEBHOOK_SECRET', 'UPLOAD_CLEANUP_SECRET']) {
  requireMinBytes(key, 32);
}

for (const migration of [
  '202607220003_beta_access_privacy.sql',
  '202607220004_workflow_invariants.sql',
  '202607220005_uploads_evidence.sql',
  '202607220006_moderation_lifecycle.sql',
  '202607220007_search_realtime_jobs.sql',
  '202607220008_first_admin_bootstrap.sql',
  '202607260009_database_lint_hardening.sql',
  '202607280010_hosted_runtime_correction.sql',
  '202607290011_production_readiness_fixes.sql'
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

if (environment.LEGAL_CONTENT_APPROVED?.trim() === 'true') {
  const draftMarkers = [
    /неодобрен/iu,
    /работна\s+(?:beta\s+)?чернова/iu,
    /липсващи\s+задължителни/iu,
    /\[[^\]]+\]/u,
    /controller pending/iu,
    /не е финал/iu
  ];
  for (const route of [
    'src/routes/legal/terms/+page.svelte',
    'src/routes/legal/privacy/+page.svelte',
    'src/routes/legal/appeals/+page.svelte'
  ]) {
    const contents = readFileSync(resolve(workspace, route), 'utf8');
    if (draftMarkers.some((marker) => marker.test(contents))) {
      failures.push(`${route} still contains draft or placeholder legal copy`);
    }
  }
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
