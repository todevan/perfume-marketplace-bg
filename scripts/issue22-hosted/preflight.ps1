$ErrorActionPreference = 'Stop'
$ref = 'zzrrutwlrkhevellwork'
$org = 'khazvscqabwvslnphbqp'

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true)]
  private static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      byte[] bytes = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length);
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(ptr); }
  }
}
'@

$token = [CredentialReader]::Read('Supabase CLI:supabase')
if ($token -notmatch '^sbp_(oauth_)?[a-f0-9]{40}$') { throw 'Supabase CLI credential shape mismatch.' }
$headers = @{ Authorization = "Bearer $token" }
$api = 'https://api.supabase.com'

function Get-Api([string]$path) {
  Invoke-RestMethod -Headers $headers -Uri "$api$path" -Method Get
}
function Query-ReadOnly([string]$sql) {
  $body = @{ query = $sql } | ConvertTo-Json -Compress
  Invoke-RestMethod -Headers $headers -Uri "$api/v1/projects/$ref/database/query/read-only" -Method Post -ContentType 'application/json' -Body $body
}

$project = Get-Api "/v1/projects/$ref"
$organization = Get-Api "/v1/organizations/$org"
$addons = Get-Api "/v1/projects/$ref/billing/addons"
$migrations = Get-Api "/v1/projects/$ref/database/migrations"
$buckets = Get-Api "/v1/projects/$ref/storage/buckets"
$functions = Get-Api "/v1/projects/$ref/functions"
$secrets = Get-Api "/v1/projects/$ref/secrets"
$auth = Get-Api "/v1/projects/$ref/config/auth"

$sql = @'
select json_build_object(
  'auth_users', (select count(*) from auth.users),
  'storage_buckets', (select count(*) from storage.buckets),
  'storage_objects', (select count(*) from storage.objects),
  'storage_bucket_definitions', coalesce((
    select json_agg(json_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id)
    from storage.buckets
  ), '[]'::json),
  'public_relations', coalesce((
    select json_agg(format('%I.%I', n.nspname, c.relname) order by n.nspname,c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  ), '[]'::json),
  'public_functions', coalesce((
    select json_agg(p.proname order by p.proname)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ), '[]'::json),
  'public_policies', coalesce((
    select json_agg(format('%I.%I:%s', schemaname, tablename, policyname) order by schemaname,tablename,policyname)
    from pg_catalog.pg_policies where schemaname = 'public'
  ), '[]'::json),
  'private_schema_exists', exists(select 1 from pg_catalog.pg_namespace where nspname = 'private'),
  'unexpected_schemas', coalesce((
    select json_agg(nspname order by nspname)
    from pg_catalog.pg_namespace
    where nspname not like 'pg_%'
      and nspname not in ('information_schema','auth','storage','realtime','extensions','graphql','graphql_public','vault','net','supabase_functions','supabase_migrations','public','cron','pgmq')
  ), '[]'::json),
  'user_triggers', coalesce((
    select json_agg(format('%I.%I:%s', n.nspname, c.relname, t.tgname) order by n.nspname,c.relname,t.tgname)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','private')
  ), '[]'::json),
  'realtime_publication_tables', coalesce((
    select json_agg(format('%I.%I', schemaname, tablename) order by schemaname, tablename)
    from pg_catalog.pg_publication_tables where pubname='supabase_realtime'
  ), '[]'::json)
) as inventory;
'@
$db = Query-ReadOnly $sql

$application = $null
$fingerprints = $null
if (@($migrations).Count -gt 0) {
  $application = @(Query-ReadOnly 'select (select count(*) from public.profiles)::int profiles,(select count(*) from public.beta_memberships)::int memberships,(select count(*) from public.beta_consent_events)::int consents,(select count(*) from public.brands)::int brands,(select count(*) from public.brand_aliases)::int aliases,(select count(*) from public.brand_collection_memberships)::int catalog_memberships')[0]
  $fingerprints = @(Query-ReadOnly (Get-Content -LiteralPath (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'definition-fingerprints.sql') -Raw))[0]
}

function Is-NullOrMissing($object, [string]$name) {
  $property = $object.PSObject.Properties[$name]
  return ($null -eq $property -or $null -eq $property.Value)
}

$credentialFields = @('security_captcha_provider','security_captcha_secret','smtp_admin_email','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_sender_name')
$credentialsCleared = -not ($credentialFields | Where-Object { -not (Is-NullOrMissing $auth $_) })

$safeAuth = [ordered]@{
  disable_signup = $auth.disable_signup
  external_email_enabled = $auth.external_email_enabled
  external_phone_enabled = $auth.external_phone_enabled
  external_anonymous_users_enabled = $auth.external_anonymous_users_enabled
  mailer_autoconfirm = $auth.mailer_autoconfirm
  site_url = $auth.site_url
  uri_allow_list = $auth.uri_allow_list
  security_captcha_enabled = $auth.security_captcha_enabled
  security_captcha_provider = $auth.security_captcha_provider
  credentials_cleared = $credentialsCleared
}
$inventory = @($db)[0].inventory
$safe = [ordered]@{
  status = 'READY_FOR_REVIEW'
  captured_at = (Get-Date).ToUniversalTime().ToString('o')
  candidate_sha = $env:ISSUE22_CANDIDATE_SHA
  project = [ordered]@{ id=$project.id; ref=$project.ref; name=$project.name; organization_id=$project.organization_id; region=$project.region; status=$project.status; database=$project.database }
  organization = [ordered]@{ id=$organization.id; name=$organization.name; plan=$organization.plan }
  selected_addons = @($addons.selected_addons)
  migrations = $migrations
  management_buckets = $buckets
  edge_function_slugs = @($functions | ForEach-Object { $_.slug })
  secret_names = @($secrets | ForEach-Object { $_.name } | Sort-Object)
  auth = $safeAuth
  quiescence = $(if($auth.disable_signup -eq $true){'QUIESCED'}else{'REQUIRES_IMMEDIATE_OPERATOR_QUIESCE'})
  database = $inventory
}

function Assert-Exact([bool]$condition, [string]$message) {
  if (-not $condition) { throw "PREFLIGHT STOP: $message" }
}

function Assert-ExactArray($actual, $expected, [string]$label) {
  $actualItems = @($actual)
  $expectedItems = @($expected)
  Assert-Exact ($actualItems.Count -eq $expectedItems.Count) "$label count differs from the reviewed migrated baseline."
  for ($index = 0; $index -lt $expectedItems.Count; $index++) {
    Assert-Exact ([string]$actualItems[$index] -ceq [string]$expectedItems[$index]) "$label differs from the reviewed migrated baseline."
  }
}

$head = (& git rev-parse HEAD).Trim()
Assert-Exact ($LASTEXITCODE -eq 0 -and $head -eq $safe.candidate_sha) 'Git HEAD is not the immutable candidate.'
& git diff --quiet
Assert-Exact ($LASTEXITCODE -eq 0) 'Tracked worktree files differ from HEAD.'
& git diff --cached --quiet
Assert-Exact ($LASTEXITCODE -eq 0) 'The index differs from HEAD.'

Assert-Exact ($project.ref -eq $ref -and $project.id -eq $ref) 'Supabase project identity mismatch.'
Assert-Exact ($project.organization_id -eq $org) 'Supabase organization mismatch.'
Assert-Exact ($project.region -eq 'eu-central-1') 'Supabase region mismatch.'
Assert-Exact ($project.status -eq 'ACTIVE_HEALTHY') 'Supabase project is not healthy.'
Assert-Exact ($organization.plan -eq 'free') 'Supabase organization is not on the Free plan.'
Assert-Exact (@($addons.selected_addons).Count -eq 0) 'A paid Supabase add-on is selected.'
Assert-Exact ([int]$inventory.storage_objects -eq 0) 'Storage objects exist.'
Assert-Exact ([int]$inventory.auth_users -eq 0) 'Auth users exist.'
Assert-Exact (@($functions).Count -eq 0) 'Edge Functions exist.'
Assert-Exact (@($secrets).Count -eq 0) 'Edge Function secrets exist.'
Assert-Exact ($auth.external_email_enabled -eq $true -and $auth.external_phone_enabled -eq $false -and $auth.external_anonymous_users_enabled -eq $false -and $auth.mailer_autoconfirm -eq $false) 'Management Auth providers/confirmation differ from the email-only boundary.'
Assert-Exact ($auth.security_captcha_enabled -eq $false -and $credentialsCleared) 'Auth CAPTCHA/SMTP credentials are not at the safe cleared baseline.'

$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $package '..\..')
$operatorManifest = Get-Content -LiteralPath (Join-Path $package 'operator-manifest.json') -Raw | ConvertFrom-Json
$fingerprintPath = Join-Path $package 'definition-fingerprints.sql'
$fingerprintFile = Get-Item -LiteralPath $fingerprintPath
$fingerprintHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $fingerprintPath).Hash.ToLowerInvariant()
Assert-Exact ($fingerprintFile.Length -eq [int64]$operatorManifest.definition_fingerprint_input.bytes -and $fingerprintHash -ceq [string]$operatorManifest.definition_fingerprint_input.sha256) 'Definition fingerprint query differs from the reviewed receipt.'
$manifest = @($operatorManifest.migrations)
$expectedVersions = @($manifest | ForEach-Object { ($_.file -split '_', 2)[0] })
$actualVersions = @($migrations | ForEach-Object { [string]$_.version })
$baselineMode = if ($actualVersions.Count -eq 0) { 'pristine' } else { 'migrated' }
if ($baselineMode -eq 'pristine') {
  Assert-Exact (@($buckets).Count -eq 0 -and [int]$inventory.storage_buckets -eq 0) 'Pristine Storage buckets exist.'
  Assert-Exact (@($inventory.public_relations).Count -eq 0) 'Pristine public relations exist.'
  Assert-Exact (@($inventory.public_functions).Count -eq 0) 'Pristine public functions exist.'
  Assert-Exact (@($inventory.public_policies).Count -eq 0) 'Pristine public RLS policies exist.'
  Assert-Exact (-not [bool]$inventory.private_schema_exists) 'Pristine private application schema exists.'
  Assert-Exact (@($inventory.unexpected_schemas).Count -eq 0) 'Pristine unexpected schemas exist.'
  Assert-Exact (@($inventory.user_triggers).Count -eq 0) 'Pristine application triggers exist.'
  Assert-Exact (@($inventory.realtime_publication_tables).Count -eq 0) 'Pristine Realtime publication has application tables.'
} else {
  Assert-Exact (($actualVersions -join ',') -eq ($expectedVersions -join ',')) 'Migrated baseline version list differs from the exact reviewed chain.'
  Assert-Exact ([bool]$inventory.private_schema_exists) 'Migrated private application schema is missing.'
  Assert-Exact ([bool]$operatorManifest.migrated_inventory.private_schema_exists) 'Reviewed migrated inventory does not require the private schema.'
  Assert-ExactArray $inventory.public_relations $operatorManifest.migrated_inventory.public_relations 'Migrated public relations inventory'
  Assert-ExactArray $inventory.public_functions $operatorManifest.migrated_inventory.public_functions 'Migrated public functions inventory'
  Assert-ExactArray $inventory.public_policies $operatorManifest.migrated_inventory.public_policies 'Migrated public policy inventory'
  Assert-ExactArray $inventory.unexpected_schemas $operatorManifest.migrated_inventory.unexpected_schemas 'Migrated non-platform schema inventory'
  Assert-ExactArray $inventory.user_triggers $operatorManifest.migrated_inventory.user_triggers 'Migrated trigger inventory'
  Assert-ExactArray $inventory.realtime_publication_tables $operatorManifest.migrated_inventory.realtime_publication_tables 'Migrated Realtime inventory'
  Assert-Exact (@($buckets).Count -eq 4 -and [int]$inventory.storage_buckets -eq 4) 'Migrated Storage bucket count differs.'
  Assert-Exact ((@($inventory.storage_bucket_definitions) | ConvertTo-Json -Depth 6 -Compress) -eq (@($operatorManifest.storage_baseline) | ConvertTo-Json -Depth 6 -Compress)) 'Migrated Storage bucket definitions differ.'
  Assert-Exact ([int]$application.profiles -eq 0 -and [int]$application.memberships -eq 0 -and [int]$application.consents -eq 0) 'Migrated baseline contains run-owned application rows.'
  Assert-Exact ([int]$application.brands -eq 196 -and [int]$application.aliases -eq 48 -and [int]$application.catalog_memberships -eq 335) 'Migrated catalogue baseline differs.'
  $actualFingerprints = [ordered]@{
    relationsSha256 = $fingerprints.relations_sha256
    storageAuthorizationSha256 = $fingerprints.storage_authorization_sha256
    typesSha256 = $fingerprints.types_sha256
    functionsSha256 = $fingerprints.functions_sha256
    policiesSha256 = $fingerprints.policies_sha256
    triggersSha256 = $fingerprints.triggers_sha256
    catalogSha256 = $fingerprints.catalog_sha256
  }
  Assert-Exact (($actualFingerprints | ConvertTo-Json -Compress) -ceq ($operatorManifest.migrated_inventory.definition_fingerprints | ConvertTo-Json -Compress)) 'Migrated definition/content fingerprints differ.'
  Assert-Exact ((@($fingerprints.application_table_counts) | ConvertTo-Json -Compress) -ceq (@($operatorManifest.migrated_inventory.application_table_counts) | ConvertTo-Json -Compress)) 'Migrated application-table inventory differs.'
  Assert-Exact (-not (@($fingerprints.application_table_counts) | Where-Object { [int64]$_.rows -ne 0 })) 'Migrated baseline contains application rows.'
  $cleanupReceiptPath = Join-Path $repo '.superpowers\issue22-hosted-new-target\baseline-establishment-receipt.json'
  Assert-Exact (Test-Path -LiteralPath $cleanupReceiptPath) 'Migrated baseline cleanup receipt is missing.'
  $cleanupReceipt = Get-Content -LiteralPath $cleanupReceiptPath -Raw | ConvertFrom-Json
  Assert-Exact (
    [int]$cleanupReceipt.receiptVersion -eq 3 -and
    $cleanupReceipt.receiptKind -eq 'baseline-establishment' -and
    @('legacy-adoption', 'pristine-migration') -contains $cleanupReceipt.establishmentMode -and
    $cleanupReceipt.candidateSha -eq $safe.candidate_sha -and
    $cleanupReceipt.projectRef -eq $ref -and
    $cleanupReceipt.cloudflareAccountId -eq '0cb7373563c400a08bd46564320dd747' -and
    $cleanupReceipt.worker -eq 'perfume-marketplace-bg-issue22' -and
    $cleanupReceipt.originRunId -match '^[0-9a-f-]{36}$' -and
    ($null -eq $cleanupReceipt.originLedgerSha256 -or $cleanupReceipt.originLedgerSha256 -match '^[0-9a-f]{64}$') -and
    (
      ($cleanupReceipt.establishmentMode -eq 'legacy-adoption' -and
       $cleanupReceipt.originRunId -eq '55ab019b-6818-42c8-8b0d-bf15864afe67' -and
       $null -eq $cleanupReceipt.originLedgerSha256 -and
       $cleanupReceipt.adoptedEvidence.predecessorSha -eq 'a9d55c0ef1138dfb33c09328abdfa59bc3981cd0' -and
       $cleanupReceipt.adoptedEvidence.recoverySha256 -eq '65a7312fe5a7829d7cd5850bc71bc3d29e57f40a991ba070c6523044b00518e3' -and
       $cleanupReceipt.adoptedEvidence.generatedConfigSha256 -eq 'afe2b4621b71c8a4a5bef19245084dfc3975ab6b0ee0f0d5af32ddf074e9b21f' -and
       $cleanupReceipt.adoptedEvidence.predecessorEvidenceMac -match '^[0-9a-f]{64}$') -or
      ($cleanupReceipt.establishmentMode -eq 'pristine-migration' -and $null -eq $cleanupReceipt.adoptedEvidence)
    ) -and
    $cleanupReceipt.payloadMac -match '^[0-9a-f]{64}$' -and
    $cleanupReceipt.etherealCredentialPersisted -eq $false -and
    [int64]$cleanupReceipt.maxSyntheticWorkerRequests -eq 587 -and
    [int64]$cleanupReceipt.maxSyntheticWorkerCpuMs -eq 17610000 -and
    $cleanupReceipt.observedFinalState.baselineMode -eq 'migrated' -and
    [int]$cleanupReceipt.observedFinalState.authUsers -eq 0 -and
    [int]$cleanupReceipt.observedFinalState.applicationRows -eq 0 -and
    [int]$cleanupReceipt.observedFinalState.storageBuckets -eq 4 -and
    [int]$cleanupReceipt.observedFinalState.storageObjects -eq 0 -and
    [int]$cleanupReceipt.observedFinalState.workerSecrets -eq 0 -and
    $cleanupReceipt.observedFinalState.widgetAbsent -eq $true -and
    $cleanupReceipt.observedFinalState.authDisabled -eq $true -and
    [int]$cleanupReceipt.observedFinalState.migrationCount -eq 18 -and
    [int]$cleanupReceipt.observedFinalState.catalog.brands -eq 196 -and
    [int]$cleanupReceipt.observedFinalState.catalog.aliases -eq 48 -and
    [int]$cleanupReceipt.observedFinalState.catalog.memberships -eq 335 -and
    (($cleanupReceipt.observedFinalState.definitionFingerprints | ConvertTo-Json -Compress) -ceq ($operatorManifest.migrated_inventory.definition_fingerprints | ConvertTo-Json -Compress))
  ) 'Migrated baseline cleanup receipt attribution differs.'
  $receiptValidation = (& node (Join-Path $package 'validate-cleanup-receipt.mjs') $cleanupReceiptPath $safe.candidate_sha 2>&1 | Out-String)
  Assert-Exact ($LASTEXITCODE -eq 0 -and (($receiptValidation | ConvertFrom-Json).status -eq 'CLEANUP_RECEIPT_VALID')) 'Migrated baseline cleanup receipt hash/shape differs.'
}
$safe.baseline_mode = $baselineMode
$migrationSelfTestText = (& node (Join-Path $package 'migration-runner.mjs') --self-test 2>&1 | Out-String)
Assert-Exact ($LASTEXITCODE -eq 0) 'Canonical candidate migration/seed self-test failed.'
$migrationSelfTest = $migrationSelfTestText | ConvertFrom-Json
Assert-Exact ($migrationSelfTest.status -eq 'LOCAL_READY' -and $migrationSelfTest.projectRef -eq $ref -and [int]$migrationSelfTest.migrations -eq 18) 'Canonical candidate migration/seed receipt mismatch.'

$nativePreference = $PSNativeCommandUseErrorActionPreference
$PSNativeCommandUseErrorActionPreference = $false
$workerConfig = Get-Content -LiteralPath (Join-Path $package 'wrangler.issue22.jsonc') -Raw | ConvertFrom-Json
$rollbackWorkerConfig = Get-Content -LiteralPath (Join-Path $package 'wrangler.issue22.rollback.jsonc') -Raw | ConvertFrom-Json
Assert-Exact ($workerConfig.name -eq 'perfume-marketplace-bg-issue22' -and $workerConfig.account_id -eq '0cb7373563c400a08bd46564320dd747' -and $workerConfig.vars.EXPECTED_SUPABASE_PROJECT_REF -eq $ref -and $workerConfig.vars.PUBLIC_SUPABASE_URL -eq "https://$ref.supabase.co" -and $workerConfig.vars.TURNSTILE_EXPECTED_HOSTNAME -eq 'perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev') 'Tracked Worker config identity mismatch.'
Assert-Exact ($rollbackWorkerConfig.name -eq 'perfume-marketplace-bg-issue22' -and $rollbackWorkerConfig.account_id -eq '0cb7373563c400a08bd46564320dd747') 'Tracked rollback Worker config identity mismatch.'
$whoamiText = (& pnpm exec wrangler whoami --json 2>&1 | Out-String)
Assert-Exact ($LASTEXITCODE -eq 0) 'Cloudflare identity lookup failed.'
$whoami = $whoamiText | ConvertFrom-Json
$cloudflareAccount = @($whoami.accounts | Where-Object { $_.id -eq '0cb7373563c400a08bd46564320dd747' })
Assert-Exact ($whoami.loggedIn -eq $true -and $cloudflareAccount.Count -eq 1) 'Cloudflare account identity mismatch.'
Assert-Exact (@($whoami.tokenPermissions) -contains 'workers:write') 'Cloudflare OAuth token lacks Worker write capability.'
Assert-Exact (@($whoami.tokenPermissions) -contains 'challenge-widgets.write') 'Cloudflare OAuth token lacks Turnstile widget capability.'
$capacityText = (& node (Join-Path $package 'cloudflare-live-capacity.mjs') 2>&1 | Out-String)
Assert-Exact ($LASTEXITCODE -eq 0) 'Current exact-account Cloudflare capacity lookup failed.'
$capacity = $capacityText | ConvertFrom-Json
Assert-Exact ($capacity.accountId -eq '0cb7373563c400a08bd46564320dd747' -and $capacity.usageModel -eq 'standard' -and $capacity.executionPlan -eq 'workers_free') 'Current Cloudflare account/Free execution policy differs.'
Assert-Exact ([int64]$capacity.operatorBudget.totalRequests -eq 587 -and [int64]$capacity.operatorBudget.freeHardTotalCpuMs -eq 5870 -and [int64]$capacity.operatorBudget.standardDefaultCpuMsPerInvocation -eq 30000 -and [int64]$capacity.operatorBudget.totalCpuMs -eq 17610000 -and [int64]$capacity.operatorBudget.maxCpuMsPerInvocation -eq 10 -and [int64]$capacity.operatorBudget.maxSubrequestsPerInvocation -eq 50) 'Current Cloudflare capacity receipt uses an unexpected operator budget.'
Assert-Exact ([double]$capacity.remainingDailyRequests -ge [double]$capacity.operatorBudget.totalRequests -and [double]$capacity.remainingMonthlyRequests -ge [double]$capacity.operatorBudget.totalRequests -and [double]$capacity.remainingMonthlyCpuMs -ge [double]$capacity.operatorBudget.totalCpuMs) 'Current Cloudflare Free/Standard capacity headroom is insufficient.'
$widgetsText = (& pnpm exec wrangler turnstile widget list --json --config (Join-Path $package 'wrangler.issue22.jsonc') 2>&1 | Out-String)
Assert-Exact ($LASTEXITCODE -eq 0) 'Turnstile inventory failed.'
$widgets = @($widgetsText | ConvertFrom-Json)
Assert-Exact ($widgets.Count -lt 20) 'Turnstile Free widget capacity is exhausted.'
Assert-Exact (-not ($widgets | Where-Object { $_.name -eq 'aromatika-issue22-isolated' -or @($_.domains) -contains 'perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev' })) 'Issue-22 Turnstile identity is already occupied.'
$workerProbe = (& pnpm exec wrangler versions list --config (Join-Path $package 'wrangler.issue22.jsonc') --name perfume-marketplace-bg-issue22 --json 2>&1 | Out-String)
$workerProbeExit = $LASTEXITCODE
$workerExists = $false
if ($baselineMode -eq 'pristine') {
  Assert-Exact ($workerProbeExit -ne 0 -and $workerProbe -match 'does not exist' -and $workerProbe -match '10007') 'The separate issue-22 Worker identity is not proven unused.'
} else {
  Assert-Exact ($workerProbeExit -eq 0) 'The migrated baseline rollback Worker is unavailable.'
  $workerSecretsText = (& pnpm exec wrangler secret list --name perfume-marketplace-bg-issue22 --config (Join-Path $package 'wrangler.issue22.jsonc') --format json 2>&1 | Out-String)
  Assert-Exact ($LASTEXITCODE -eq 0 -and @($workerSecretsText | ConvertFrom-Json).Count -eq 0) 'The migrated baseline rollback Worker has secrets.'
  $workerExists = $true
}
$PSNativeCommandUseErrorActionPreference = $nativePreference
$safe.cloudflare = [ordered]@{
  account_id='0cb7373563c400a08bd46564320dd747'; account_type=$cloudflareAccount[0].type
  worker_name='perfume-marketplace-bg-issue22'; worker_exists=$workerExists
  turnstile_widget_count=$widgets.Count; turnstile_free_capacity_remaining=(20-$widgets.Count)
  live_capacity=$capacity
  zero_incremental_cost_basis=@(
    'Turnstile Free supports 20 widgets and unlimited challenges',
    'Workers Free allows 100000 requests/UTC day, hard-limits dynamic invocations to 10 CPU ms and 50 subrequests, and static assets are free',
    'Workers Standard includes 10000000 requests and 30000000 CPU ms/month if the existing account is already paid',
    'operator caps all synthetic paths at 587 requests: Free hard-limits that path to 5870 CPU ms, while the no-explicit-limit Standard default yields a conservative 17610000 CPU-ms paid-plan headroom bound'
  )
}
$safe.local_migrations = $manifest
$safe.local_seed_inputs = $operatorManifest.seed_inputs
$safe.catalog_baseline = $operatorManifest.catalog_baseline

$token = $null
$headers = $null
$privatePath = Join-Path $package 'private'
New-Item -ItemType Directory -Force -Path $privatePath | Out-Null
$receiptPath = Join-Path $privatePath 'preflight-receipt.json'
$safe | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$receiptHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $receiptPath).Hash.ToLowerInvariant()
[ordered]@{ status='READY_FOR_REVIEW'; quiescence=$safe.quiescence; receipt=$receiptPath; sha256=$receiptHash } | ConvertTo-Json
