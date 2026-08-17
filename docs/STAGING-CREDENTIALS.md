# Staging credentials and configuration

## Purpose

Use this checklist when connecting the staging Cloudflare Worker and trusted operator tooling to hosted services.

This document defines:

- the authorized staging targets;
- credential ownership;
- where secrets may and may not be stored;
- provider-specific configuration boundaries;
- guarded staging commands;
- safe staging configuration invariants.

It does not define the current Gate 3 execution step or authorize a hosted mutation by itself.

Before changing hosted state, also consult:

- `AGENTS.md`;
- `docs/PROJECT-STATUS.md`;
- the current GitHub issue;
- the applicable reconciliation/release plan;
- `docs/agents/AUTONOMY.md`;
- `docs/agents/HUMAN-GATES.md`.

A correct credential and a correct provider target are necessary but do not expand named-gate scope.

For example:

```text
valid staging credentials
+
correct Frankfurt target
+
A9 only
```

still means only A9-authorized mutations may be performed.

---

# General credential rules

No provider credentials are required for ordinary local tests, dependency audits, Cloudflare configuration validation or dry-run commands that do not contact protected hosted resources.

Real credentials are required only when an authorized hosted service operation actually needs them.

Never copy production credentials into staging.

Never store real secrets in:

- `wrangler.jsonc`;
- committed `.env` files;
- committed documentation;
- source code;
- pull-request-visible GitHub variables;
- CI logs;
- screenshots or receipts intended for repository storage.

Use the provider's protected secret store or the explicitly approved trusted local operator environment.

---

# Current operational state

Do not use historical checkpoint tables in this document as the source of current Gate 3 state.

Current operational state lives in:

`docs/PROJECT-STATUS.md`

This document intentionally avoids hard-coding volatile claims such as:

- current migration tip;
- current Auth-user count;
- current Storage-object count;
- current Worker deployment ID;
- current known-good rollback version;
- current provider activation state;
- active Gate 3 sub-step.

Verify those against the current repository/provider evidence required by the active gate.

Historical receipts remain useful as evidence of what was true at the time they were recorded, but they are not permanent expected state.

---

# Authorized hosted staging identity

The authorized hosted Supabase staging target is:

| Property | Required value |
|---|---|
| Project name | `perfume-marketplace-bg-staging` |
| Project ref | `nuhkpqjjyuygiemrxbdp` |
| Organization | `khazvscqabwvslnphbqp` |
| Region | `eu-central-1` (Frankfurt) |
| PostgreSQL major | `17` |
| Required health | `ACTIVE_HEALTHY` |

The authorized staging Supabase URL is:

```text
https://nuhkpqjjyuygiemrxbdp.supabase.co
```

The previous Stockholm project:

```text
zllqwlekadiuyejgbuxc
```

is not an authorized target.

Do not:

- link to it;
- migrate it;
- seed it;
- reset it;
- repair it;
- use its credentials;
- copy data from it;
- treat it as fallback staging.

Every hosted staging database operation must pass the repository target guard for the Frankfurt project.

Run:

```powershell
pnpm db:staging:verify-target
```

before hosted database operations when required by the operator contract.

The guard must fail closed on an identity, organization, region, PostgreSQL-version, health, URL or project-bound-key mismatch.

Do not disable the guard to make a gate proceed.

---

# Canonical repositories

The canonical repository is:

```text
todevan/perfume-marketplace-bg
```

The older repository:

```text
todevan/remix-of-scent-exchange
```

is out of scope.

Do not:

- add it as an active remote;
- push to it;
- rewrite it;
- archive it;
- use it as deployment source;
- use it as migration source;
- copy credentials from it.

If repository identity or history is unexpected, stop and reconcile it rather than force-pushing or merging unrelated history.

---

# GitHub operating model

The repository currently uses a minimal GitHub deployment model rather than relying on GitHub to enforce every release boundary.

A push or merge is not deployment authorization.

Staging deployment must use the exact source revision authorized by the active release/gate process.

The GitHub Actions staging deployment is manually dispatched where the current workflow requires it.

The initial staging deployment model uses only the GitHub repository secrets required for Cloudflare deployment:

- `CLOUDFLARE_API_TOKEN`;
- `CLOUDFLARE_ACCOUNT_ID`.

Do not move runtime Supabase, Resend, Turnstile or other provider secrets into GitHub merely for convenience.

Production GitHub deployment credentials remain unavailable until the production release process explicitly authorizes them.

---

# Secret ownership

Keep secrets with the system that owns their use.

## Trusted local operator

The trusted local shell or official local CLI profile may hold, when an authorized operation requires them:

- Supabase CLI access token;
- Supabase database password;
- privileged Supabase service-role credential used by legacy/operator tooling;
- first-admin bootstrap values;
- other explicitly operator-only values.

These must not be copied into:

- GitHub repository secrets unless explicitly required by an approved workflow;
- Cloudflare public variables;
- committed files;
- documentation;
- logs.

Clear highly privileged transient values from the shell after the operation when practical.

---

## GitHub

GitHub owns only deployment credentials required by the current staging workflow.

Currently:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

The Cloudflare deployment token should remain least-privilege and account-scoped as required by the deployment workflow.

Credential rotation should follow the provider's actual current expiry/rotation requirement.

Do not rely on an old calendar date in documentation without checking the current credential/provider state.

---

## Cloudflare Worker

Runtime application configuration belongs on:

```text
perfume-marketplace-bg-staging
```

Secrets must use Cloudflare's protected secret mechanism.

The current server-side Supabase application secret is:

```text
SUPABASE_SECRET_KEY
```

Do not copy a legacy service-role credential into ordinary Worker runtime configuration unless the current architecture explicitly requires it for a narrowly defined server/operator path.

Non-secret staging variables and browser-safe values should follow the current `wrangler.jsonc` environment contract.

If `keep_vars: true` is enabled, remember that preserved provider state is not automatically correct state.

---

## Supabase Edge Functions

Provider/function secrets required by Edge Functions belong in Supabase's protected function secret environment.

Examples may include:

- service-role credentials required by the function architecture;
- Resend API credentials;
- notification webhook secret;
- upload cleanup secret.

Use approved Supabase secret tooling.

Do not place these values in Database Webhook URLs or public request parameters.

---

## Offline backup secrets

`BACKUP_ENCRYPTION_KEY` is an offline backup/restore secret.

It must not be configured as an ordinary Worker runtime secret.

Keep it separate from the encrypted backup data itself.

See:

`docs/BACKUP-RESTORE.md`

for the backup/restore procedure.

---

# Dashboard locations

| System | Location | Values / purpose |
|---|---|---|
| GitHub | Repository **Settings → Secrets and variables → Actions → Secrets** | Approved deployment-only repository secrets |
| GitHub | Repository **Actions → deploy staging → Run workflow** | Manual staging dispatch when required |
| Cloudflare | **Workers & Pages → perfume-marketplace-bg-staging → Settings → Variables and Secrets** | Worker runtime configuration and secrets |
| Cloudflare | **Workers & Pages → perfume-marketplace-bg-staging → Deployments** | Current deployment/version and rollback evidence |
| Supabase | Organization `khazvscqabwvslnphbqp` → `perfume-marketplace-bg-staging` (`nuhkpqjjyuygiemrxbdp`) → **Connect / API Keys** | Project URL, browser-safe key and protected server credentials |
| Supabase | **Authentication → URL Configuration** | Site URL and approved redirects |
| Supabase | **Authentication → Sign In / Providers → Email** | Email/password signup and confirmation configuration |
| Supabase | **Authentication → Users** | Current hosted Auth users |
| Supabase | **Storage** | Current buckets and objects |
| Supabase | Edge Functions / Secrets | Function deployment and protected provider values |

Do not assume historical counts such as `0 Auth users` or `0 Storage objects`.

Those were checkpoint observations, not permanent configuration requirements.

---

# Cloudflare configuration

## Deployment credentials

| Name or binding | Classification | Where used | Requirement |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | GitHub staging deployment / real Wrangler deploy | Required for authorized real deploys |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier | Deployment workflow and release verification | Required for authorized real deploys |
| `IMAGES` | Cloudflare binding | Trusted image pipeline | Required before Cloudflare Images processing is enabled |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Secret | Images provisioning/operator operations where required | Configure only when the active image-provider work needs it |
| `IMAGE_PROCESSOR_MODE` | Runtime configuration | Worker upload/evidence pipeline | Keep fail-closed until trusted image processing is accepted |

The staging Worker origin is:

```text
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev
```

`PUBLIC_APP_URL` must use the exact authorized HTTPS origin with no path, query or fragment.

---

# Cloudflare inventory before mutation

Before an authorized real Worker deployment or provider configuration change, inventory the relevant:

- Cloudflare account;
- Worker name;
- routes;
- deployments;
- variables;
- secrets;
- Images bindings;
- `workers.dev` exposure;
- deployment token scope.

Stop when:

- the account is wrong;
- target identity is ambiguous;
- unknown configuration exists where the gate requires a known baseline;
- traffic/configuration conflicts with the active plan;
- token scope is unexpectedly broad;
- inventory cannot be completed.

Do not overwrite another Worker merely because its name appears similar.

---

# Worker rollback

Rollback must use the current verified known-good staging deployment required by the active release/gate process.

Do not treat an old Worker version from an earlier bootstrap checkpoint as the permanent rollback target.

Before a risky deployment, record or verify the current safe target.

If staging verification fails:

1. stop further dispatch/provider testing;
2. record the failed deployment/version and exact tested Git SHA;
3. roll back to the current verified safe Worker target when available;
4. rerun the applicable rollback smoke checks;
5. keep the failed gate/workflow failed;
6. investigate before redeploying.

If no functional safe runtime exists, keep the application fail-closed or disable exposed staging access until corrected.

Do not use database reset or migration-history changes as an application rollback mechanism.

---

# Supabase mandatory inventory

Before authorized hosted database mutation, verify the current target state required by the active gate.

Inventory as applicable:

- organization;
- project name;
- project ref;
- URL;
- region;
- health;
- migration history;
- non-system schemas/tables/views/functions;
- triggers;
- extensions;
- RLS policies;
- scheduled jobs;
- Realtime publications;
- Storage buckets and objects;
- Edge Functions;
- webhooks;
- secret names;
- `auth.users` counts/state;
- relevant application data;
- Auth signup configuration;
- Site URL;
- redirect allow-list;
- email provider state;
- MFA configuration.

Stop if evidence suggests:

- wrong target;
- production/real personal data contamination;
- another application's state;
- unexplained provider state relevant to the active gate;
- insufficient permissions to prove the required preconditions.

A mismatch is not permission to erase the mismatch.

---

# Destructive database operations are not staging repair tools

Never run the following against hosted staging merely to restore an expected baseline:

```text
supabase db reset
supabase migration repair
schema drop
blanket truncate
migration-history rewrite
```

`supabase db reset` is local-only.

Shared hosted migrations remain forward-only.

If a hosted migration needs remediation, use a new reviewed forward-only migration when authorized.

If hosted state materially disagrees with the expected gate state, stop and reconcile it through the appropriate issue/gate process.

---

# Guarded staging database commands

Use the repository's target-locked commands:

```powershell
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
pnpm db:staging:push
pnpm seed:staging
pnpm db:staging:types
pnpm db:staging:types:check
```

Use only the commands required by the active issue/gate.

Do not substitute:

- raw unguarded linked pushes;
- remote reset;
- migration repair;
- unguarded seed scripts

when repository target-locked equivalents exist.

The current migration directory plus verified hosted migration history determine the expected migration state.

Do not hard-code an old migration tip such as `001–010`, `001–011` or `012` as a permanent target.

---

# Catalogue contract

The known catalogue contract includes:

```text
196 brands
48 aliases
335 editorial memberships
80 / 80 / 80 / 80 / 15 collection split
```

Use the repository's current catalogue validator as executable authority.

A catalogue mismatch discovered during unrelated provider work should be investigated rather than patched manually.

Do not hand-edit partial seed state to make counts match.

---

# Supabase application values

| Name | Classification | Where used | Requirement |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | Public project URL | Browser/server client and approved tooling | Required for connected staging |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible key | Browser/server Supabase client | Required for connected staging |
| `SUPABASE_SECRET_KEY` | Secret | Trusted server-side Worker operations | Required by the current hosted application server contract |
| `SUPABASE_SERVICE_ROLE_KEY` | Highly privileged secret | Edge Functions/operator/legacy tooling where explicitly required | Configure only in the trusted surface that requires it |
| `PUBLIC_SUPABASE_ANON_KEY` | Legacy browser-visible fallback | Legacy/local compatibility | Prefer the current publishable-key model |
| `SUPABASE_URL` | Provider runtime value | Supabase Edge Functions | Verify in the hosted function environment where required |

RLS remains the browser/data-access boundary.

A browser-visible publishable key is not authorization to bypass RLS.

Never expose a server secret or service-role credential to browser code.

---

# Hosted Auth configuration

The intended regular-user product model is public email/password registration.

For the normal hosted staging configuration when registration testing is authorized:

- public email/password signup: enabled;
- anonymous signup: disabled;
- email confirmation: enabled;
- Site URL:

```text
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev
```

- redirect allow-list:

```text
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev/auth/callback
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev/auth/confirm
```

Custom SMTP, CAPTCHA/Turnstile and other provider state must follow the active Gate 3 plan rather than old infrastructure-baseline assumptions.

Do not state that SMTP or CAPTCHA must remain unconfigured merely because an earlier bootstrap checkpoint deferred them.

No SMS provider is required for ordinary regular-user authentication.

---

## Auth mutation scope

Do not run a broad configuration push merely to make local and hosted Auth settings look alike.

In particular, do not blindly run:

```text
supabase config push
```

against hosted staging when local configuration contains localhost/test-only values.

Make only the exact hosted Auth mutation authorized by the current gate.

If signup state is a prerequisite owned by another gate or owner action, do not change it under an `A9 only` instruction merely because the desired final product configuration is known.

Product policy and current mutation authority are separate questions.

---

# Resend

| Name | Classification | Where used |
|---|---|---|
| `RESEND_API_KEY` | Secret | Transactional email / notification provider |
| `RESEND_FROM_EMAIL` | Sender configuration | Auth/notification sender |
| `NOTIFICATION_WEBHOOK_SECRET` | Secret, minimum repository-required strength | Supabase notification webhook ↔ `notification-email` authentication |

Use separate staging values.

Do not store the API key in source control.

Configure the actual required sender/provider state according to the current hosted gate.

A previously deferred provider may now be required by a later gate; check `docs/PROJECT-STATUS.md` and the applicable reconciliation plan instead of this document's historical checkpoint.

---

# Turnstile

| Name | Classification | Where used |
|---|---|---|
| `PUBLIC_TURNSTILE_SITE_KEY` | Browser-visible site key | Protected-form UI |
| `TURNSTILE_SECRET_KEY` | Secret | Server-side verification |
| `TURNSTILE_EXPECTED_HOSTNAME` | Hostname configuration | Server-side origin/hostname validation |

The expected hostname must correspond to the authorized staging `PUBLIC_APP_URL`.

Use provider values appropriate to the active staging acceptance step.

Do not commit real Turnstile secrets.

Do not weaken server-side verification to make hosted E2E easier.

---

# Cloudflare Images

The application uses trusted image normalization before supported uploaded evidence becomes finalized marketplace content.

Required Cloudflare Images state must follow the active provider/gate plan.

Do not enable the image processor merely because the `IMAGES` binding exists.

The appropriate acceptance tests must pass first.

---

# Application, consent and safety configuration

| Name | Classification | Staging rule |
|---|---|---|
| `APP_ENV` | Private environment label | `staging` |
| `PUBLIC_DEMO_MODE` | Public/runtime flag | `false` |
| `PUBLIC_APP_URL` | Public HTTPS origin | Exact authorized staging Worker origin |
| `PRIVATE_BETA_REQUIRE_STAFF_MFA` | Private policy flag | `true` |
| `TERMS_VERSION` | Public consent identifier | Match the exact deployed Terms version |
| `PRIVACY_VERSION` | Public consent identifier | Match the exact deployed Privacy version |
| `MARKETPLACE_RULES_VERSION` | Public consent identifier | Match the exact deployed Marketplace Rules version |
| `LEGAL_CONTENT_APPROVED` | Release flag | Keep `false` until actual published legal content is approved |
| `INCIDENT_CONTACT_EMAIL` | Operational contact | Use the current approved/monitored staging or safety contact when required |

Consent identifiers must change when the accepted text they identify changes.

Do not use `LEGAL_CONTENT_APPROVED=true` merely to bypass a release check.

---

# Staff MFA

Staff/admin security remains mandatory.

Do not weaken:

```text
PRIVATE_BETA_REQUIRE_STAFF_MFA=true
```

or the database-authoritative AAL2 boundary for staging tests.

Synthetic hosted moderators must satisfy the authentication/MFA state required by the gate they are used to prove.

---

# First administrator bootstrap

Legacy first-administrator bootstrap remains a special operator-only compatibility path.

It is not the normal public user-registration model.

Where still present, its security invariants include:

- service-role-only execution;
- staging-only execution when applicable;
- one-time binding semantics;
- no implicit legal-consent acceptance;
- no bypass of required email confirmation/onboarding;
- no bypass of staff MFA.

Use the current operator implementation and current gate plan as the executable authority.

Do not run the bootstrap merely because instructions exist in this file.

It requires explicit current scope.

Never store first-admin secrets/values in GitHub, Worker configuration or committed documentation.

---

# Notifications and cleanup

## Notification delivery

The notification path uses the architecture-defined:

```text
database notification
→ authenticated webhook
→ notification Edge Function
→ delivery ledger
→ Resend
```

Use the dedicated webhook secret.

Never send the service-role credential in a Database Webhook header.

Verify notification provider behavior through the gate/test contract that currently applies.

---

## Upload cleanup

| Name | Classification | Rule |
|---|---|---|
| `UPLOAD_CLEANUP_SECRET` | Secret | Per-environment, repository-required minimum strength |
| `UPLOAD_CLEANUP_BATCH_SIZE` | Private operational setting | Use the currently supported range/default |
| `FINALIZED_IMAGE_BUCKET` | Storage configuration | Use current architecture/tooling default unless explicitly overridden |

Scheduler behavior must follow the currently approved operator/release contract.

Do not invent retry semantics if a current Human Gate or later decision governs them.

Never put cleanup secrets in URLs.

Do not log private object paths unnecessarily.

---

# Backup configuration

| Name | Classification | Rule |
|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | Offline secret | Required by backup/restore tooling |
| `BACKUP_DIRECTORY` | Local path | Use current tooling/default |
| `FINALIZED_IMAGE_BUCKET` | Storage setting | Use current application/tooling contract |

Backup and restore procedures may require trusted Supabase credentials.

See:

`docs/BACKUP-RESTORE.md`

Do not store `BACKUP_ENCRYPTION_KEY` with the encrypted backup set.

Do not expose it to the Worker runtime unless the backup architecture explicitly changes.

---

# Keep monetisation and payments disabled

Staging monetisation remains disabled unless a future explicitly authorized billing phase says otherwise.

Expected disabled state:

```dotenv
FEATURE_BILLING_ENABLED=false
FEATURE_LISTING_FEES_ENABLED=false
FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED=false
FEATURE_BOOSTS_ENABLED=false
FEATURE_DIRECT_ADS_ENABLED=false
FEATURE_MYPOS_PAYMENTS_ENABLED=false
FEATURE_STRIPE_FALLBACK_ENABLED=false
PAYMENT_PROVIDER=disabled
```

Do not provision production-style payment credentials during unrelated staging security/reconciliation work.

That includes, unless an authorized billing test specifically requires them:

```text
MYPOS_SID
MYPOS_WALLET_NUMBER
MYPOS_KEY_INDEX
MYPOS_CHECKOUT_URL
MYPOS_PRIVATE_KEY
MYPOS_PUBLIC_CERTIFICATE
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Payment scaffolding does not authorize billing.

---

# Staging deployment checks

A typical pre-dispatch sequence may include:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm test:e2e
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
pnpm exec wrangler deploy --dry-run --env staging
```

This list is not a competing execution workflow.

Use the exact checks required by:

- the current GitHub issue;
- the active reconciliation/release plan;
- repository verification policy.

Do not rerun completed gate evidence merely because it appears in this document.

---

# Exact-source deployment evidence

When staging deployment is used as gate evidence, distinguish:

```text
local candidate
remote main
merged commit
Worker version
deployment
active traffic
provider configuration
```

Prove the exact relationships required by the current gate.

Do not infer deployment convergence from branch names.

Historical deployment/version IDs in earlier receipts remain historical evidence only.

---

# Registration ramp

Registration is ordinary email/password signup under the current product policy.

The beta cohort may still be expanded gradually for operational safety.

A typical progression may be:

```text
synthetic/internal actors
→ small real-user cohort
→ approximately 10 users
→ approximately 30–50 users
→ later authorized expansion
```

This is a go-to-market/operational ramp.

It is not invite-only authentication.

Pause expansion for material failures such as:

- P0/P1 security or correctness issues;
- cross-account data access;
- unauthorized moderation access;
- lost finalized uploads/evidence;
- failed required restore capability;
- unexpected monetisation path;
- material privacy failure.

---

# Production boundary

Production remains a separate protected environment.

Do not:

- create production resources;
- configure production credentials;
- deploy production Workers;
- mutate production Auth/database;
- change production DNS/domain;
- enable production billing;

under ordinary staging credentials/setup work.

Production mutations require the applicable repository R3 and Human Gate authorization.

---

# Historical bootstrap checkpoint

The July 2026 bootstrap records in earlier revisions of this file remain useful historical evidence for:

- initial Frankfurt staging identity;
- first functional Worker deployment;
- initial CI receipts;
- initial fail-closed deployment;
- then-empty Auth/Storage state;
- then-current migration history.

They must not be interpreted as permanent current-state requirements.

In particular:

```text
0 Auth users
0 Storage objects
migrations 001–010
signup disabled
Resend deferred
Turnstile deferred
specific Worker rollback UUID
```

were checkpoint facts, not timeless staging configuration.

Use Git/GitHub/Cloudflare/Supabase evidence when historical receipt details are needed.

---

# Agent and skill interaction

This document provides staging credential/configuration constraints.

It does not create another planning, debugging, TDD, deployment or completion workflow.

Use:

`docs/agents/SKILL-ROUTER.md`

for skill routing.

The relationship remains:

```text
repository / issue / gate authority
        ↓
Superpowers primary process
        ↓
Matt Pocock engineering-depth reasoning when useful
        ↓
ECC / platform specialist when useful
        ↓
repository-defined verification
```

ECC/platform specialists may be especially useful for:

- Supabase;
- Cloudflare;
- GitHub;
- Resend;
- Turnstile;
- E2E/provider verification;
- security.

Their expertise does not authorize additional provider mutations.

No skill may:

- bypass target locks;
- expose secrets;
- broaden a named gate;
- weaken MFA/RLS;
- switch to production;
- create a competing deployment process.

---

# Core staging credential invariant

```text
Use only the Frankfurt staging target.
Keep production and staging credentials separate.
Keep secrets with the provider/operator surface that owns them.
Use target-locked hosted commands.
Do not turn historical checkpoints into current expected state.
Do not resurrect removed SMS/invite requirements.
Do not weaken MFA, RLS or fail-closed behavior for testing.
Correct credentials do not broaden named-gate authority.
Production remains protected.
```