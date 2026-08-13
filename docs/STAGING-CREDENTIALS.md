# Staging credentials and configuration

Use this checklist when connecting the staging Cloudflare Worker to the hosted
services. It covers the values that already exist in `.env.example`, the
deployment workflow, and the current backup and Edge Function scripts.

No provider credentials are required for local tests, dependency audits,
Cloudflare configuration validation, or either
`wrangler deploy --dry-run` command. Real credentials are needed only when a
hosted staging service is connected or deployed.

Do not copy production credentials into staging. Store secrets in the provider
or as explicitly listed GitHub repository secrets, never in `wrangler.jsonc`,
a committed `.env` file, or a pull-request-visible GitHub variable.

## Current hosted staging checkpoint

Checkpoint date: 2026-07-28. This records the then-current backend-connected,
signup-locked environment. The 2026-08-02 owner decision supersedes the invite
model: the environment is not usable until migration `012` is applied and
public email/password signup is enabled with email confirmation.

| Area | Verified state |
|---|---|
| GitHub | `todevan/perfume-marketplace-bg` exists as the new canonical private repository. The older `todevan/remix-of-scent-exchange` repository remains untouched. |
| Quality CI | Workflow run `30343704378` is green on `main` commit `39867216c0440077476ce13f89bd1f40505bef8e`: application job `90224876706` and database job `90224876599` both passed. |
| Local database | The disposable local stack matches hosted PostgreSQL major version 17. Migrations `001`–`011` apply locally, SQL lint is clean, and all 132 pgTAP assertions pass. |
| Local catalogue | The atomic seed contains 196 brands, 48 aliases, and 335 editorial memberships. Membership counts are exactly 80 men, 80 women, 80 unisex, 80 niche, and 15 Arabic. |
| Cloudflare account | Account ID `0cb7373563c400a08bd46564320dd747` owns the staging Worker. |
| Cloudflare Worker | `perfume-marketplace-bg-staging` is available at `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev`. |
| Fail-closed rollback | Git SHA `c7d2b19` remains the recorded bootstrap checkpoint. Cloudflare Worker version `75593db4-12fd-486d-ae8a-bdf9ebbb3ece` is the explicit safe `503` rollback target while the new functional receipt is pending. |
| Hosted Supabase identity | The bootstrap project label `wow` was renamed to `perfume-marketplace-bg-staging`. Ref `nuhkpqjjyuygiemrxbdp` belongs to organization `khazvscqabwvslnphbqp`, runs in `eu-central-1` (Frankfurt), and reports PostgreSQL 17 with `ACTIVE_HEALTHY`. |
| Hosted Supabase result | Migrations `001`–`010` are recorded. The runtime has 4 Storage buckets with 0 objects, 12 Realtime publication tables, 2 scheduled jobs, and 0 Auth users or identities. The catalogue contains 196 brands, 48 aliases, and 335 memberships with exact `80/80/80/80/15` collection counts. |
| Hosted Auth lock | Public signup and anonymous signup are disabled; email confirmation is enabled. Site URL is the exact staging Worker origin, and only its `/auth/callback` and `/auth/confirm` URLs are allowed. SMTP, SMS, and CAPTCHA are unconfigured. |
| Configured Worker | Commit `39867216c0440077476ce13f89bd1f40505bef8e` was deployed as Worker version `9024d848-dcd7-4894-b6da-d2f2453b2df0`, deployment `0ce71c4c-4e9e-4118-b813-62e4fb6a5260`. The backend-attested exact-SHA HTTP smoke passed all 13 checks. |
| GitHub staging deploy | A separate account-scoped Cloudflare token with only Workers Scripts Write is stored as `CLOUDFLARE_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` is also present. Manual `workflow_dispatch` run `30343975074` passed, and its logs contained no raw Supabase, GitHub, Cloudflare bearer, or JWT token patterns. |
| External providers | Resend, Turnstile, Cloudflare Images processing, real-provider E2E, and backup/restore rehearsal remain deferred. SMS is no longer required. |
| Production | Locked. No production project, route, secret, deployment, domain, user, invitation, or payment capability is authorized by this checkpoint. |

The previous Stockholm project `zllqwlekadiuyejgbuxc` remains untouched and is
not an authorized target. Every hosted database operation must pass the guard
for ref `nuhkpqjjyuygiemrxbdp`, organization `khazvscqabwvslnphbqp`, region
`eu-central-1`, PostgreSQL 17, and `ACTIVE_HEALTHY`. The first functional
`main` deployment and its recorded smoke evidence are listed below. The
environment remains an internal backend baseline, not a usable beta.

### First functional backend-baseline receipts

These fields intentionally describe the deployment immediately before the
receipt-only documentation commit.

| Receipt | Value |
|---|---|
| Baseline code `main` Git SHA | `39867216c0440077476ce13f89bd1f40505bef8e` |
| Quality workflow run ID | `30343704378` |
| Quality application job ID | `90224876706` |
| Quality database job ID | `90224876599` |
| First functional staging deploy run ID | `30343975074` |
| First functional Worker version ID | `9024d848-dcd7-4894-b6da-d2f2453b2df0` |
| First functional Worker deployment ID | `0ce71c4c-4e9e-4118-b813-62e4fb6a5260` |
| First hosted HTTP smoke receipt | `13/13 passed`; exact Git SHA and Frankfurt backend catalogue attestation passed; rollback steps were correctly skipped |

After this table is committed, deploy that new documentation SHA once more.
The immutable GitHub Actions run and Cloudflare deployment records are the
authoritative final exact-SHA receipt; copying that SHA back into this tracked
file would create an endless self-referential commit cycle.

### Keep secrets with their current owner

- The local Wrangler OAuth profile is for trusted operator use. Do not export
  its token to GitHub.
- A Supabase CLI access token, database password, service-role key, and
  first-admin bootstrap values belong only in the trusted local shell or the
  official local CLI profile.
- GitHub owns a separate, account-scoped Cloudflare API token with only Workers
  Scripts Write. Its repository secrets are `CLOUDFLARE_API_TOKEN` and account
  ID `0cb7373563c400a08bd46564320dd747` as
  `CLOUDFLARE_ACCOUNT_ID`. Rotate the token no later than 2026-10-25.
- Worker runtime configuration belongs on
  `perfume-marketplace-bg-staging`. Store `SUPABASE_SECRET_KEY` as a Worker
  secret—the only Supabase secret on this Worker. Non-secret staging variables,
  browser-safe Supabase values, and feature flags are source-controlled under
  `env.staging.vars` in `wrangler.jsonc`; never copy the legacy service-role
  key there.
- Never copy a Supabase personal access token, database password,
  service-role key, Cloudflare OAuth token, or first-admin values into GitHub
  repository secrets, documentation, CI logs, or committed files.

## GitHub Free repository model

The new canonical private repository is
`todevan/perfume-marketplace-bg`. The older
`todevan/remix-of-scent-exchange` repository is out of scope and must remain
untouched: do not add it as a remote, push to it, rewrite it, archive it, or
copy credentials from it.

This project intentionally uses a minimal GitHub Free operating model:

- staging deployment is manual only; a push or merge must not be treated as
  deployment approval;
- the GitHub Actions run must be started with `workflow_dispatch` for the
  exact tested branch/commit;
- the only GitHub repository secrets required for the initial staging deploy
  are `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
- no GitHub Environment reviewer gate, protected environment, protected branch,
  or required status-check enforcement is assumed;
- repository administrators must therefore verify the selected commit SHA and
  the successful local/CI checks before manually starting staging;
- production deployment and production GitHub secrets remain deferred.

Before connecting the local repository, verify that the new remote is the
intended private repository and inventory its refs. If it is not empty or its
history is unexpected, stop. Do not force-push, reset the remote, merge
unrelated history, or attempt a repair without a separately approved
reconciliation plan.

### Dashboard locations and secret ownership

| System | Exact dashboard location | Values owned there |
|---|---|---|
| GitHub | Repository **Settings → Secrets and variables → Actions → Secrets → New repository secret** | Only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub | Repository **Actions → deploy staging → Run workflow**, branch `main` | Manual staging dispatch and deployed commit SHA |
| Cloudflare | **Workers & Pages → perfume-marketplace-bg-staging → Settings → Variables and Secrets** | Worker runtime variables and `SUPABASE_SECRET_KEY` |
| Cloudflare | **Workers & Pages → perfume-marketplace-bg-staging → Deployments** | Active deployment/version ID and rollback target |
| Supabase | Organization `khazvscqabwvslnphbqp` → project `perfume-marketplace-bg-staging` (`nuhkpqjjyuygiemrxbdp`) → **Connect** or **Settings → API Keys** | Publishable key and server secret; copy them only into their intended secret store |
| Supabase | Project **Authentication → URL Configuration** | Exact Site URL and allowed `/auth/callback` and `/auth/confirm` redirects |
| Supabase | Project **Authentication → Sign In / Providers → Email** | Enable public email/password signup, keep anonymous signup disabled, and keep email confirmation enabled |
| Supabase | Project **Authentication → Users** and **Storage** | Confirmed 0 Auth users/identities and 0 Storage objects; the 4 empty buckets are migration-owned |

The trusted local shell owns the Supabase CLI access token, database password,
legacy service-role key when required by operator tooling, and first-admin
bootstrap values. They do not belong in GitHub, Cloudflare Worker variables or
committed files. GitHub owns only the two least-privilege Cloudflare deployment
values listed above. Clear the database password and legacy service-role key
from the shell environment after the hosted command that needs them.

## Connect Cloudflare first

| Name or binding | Classification | Where it is used | When it is required |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | GitHub staging deployment job and real Wrangler deploy | Required for a real staging deploy; not required for dry-runs |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier | GitHub staging deployment job and the production-readiness contract | Required for a real staging deploy |
| `IMAGES` | Cloudflare binding, not a secret | Worker upload route through the staging `wrangler.jsonc` environment | Required before enabling the Cloudflare Images processor |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Secret | Images provisioning/operations and the production-readiness contract; the application upload route uses the `IMAGES` binding instead | Can be deferred until the image pipeline is configured and tested |
| `IMAGE_PROCESSOR_MODE` | Private runtime configuration | Worker upload pipeline | Keep `disabled` for the first deploy; change to `cloudflare-images` only after the binding and sanitizer pass their tests |

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub
**repository secrets** in `todevan/perfume-marketplace-bg`. Configure the
sole application secret, `SUPABASE_SECRET_KEY`, on the
`perfume-marketplace-bg-staging` Worker. The committed `wrangler.jsonc` is
authoritative for every non-secret staging variable. Its `keep_vars: true`
preserves only provider values not explicitly specified by the deployment;
committed staging variables are reapplied on each deploy.

The staging `workers.dev` address is intentionally available for internal
testing. `PUBLIC_APP_URL` must use the exact HTTPS origin assigned to that
Worker, with no path, query, or fragment.

### Cloudflare inventory, bootstrap, and rollback gate

Before each real deploy, inventory the Cloudflare account, Worker names,
routes, existing deployments, variables, secrets, Images bindings, and
`workers.dev` exposure. Stop if the account is wrong, the expected staging
Worker already contains unknown configuration or traffic, the API token has
broader unexplained access, or the inventory cannot be completed. Do not
overwrite an existing Worker to make the names match.

The bootstrap is fail-closed:

1. Record the exact tested Git commit and run both Wrangler dry-runs locally.
2. Authenticate Wrangler locally, confirm the intended Cloudflare account, and
   deploy explicitly with `--env staging`. Wrangler creates
   `perfume-marketplace-bg-staging`; do not create a similarly named Worker by
   hand. Until runtime configuration exists, an application `503` is the
   expected safe result.
3. Configure the new Worker with the inventoried Supabase values and keep
   `PUBLIC_DEMO_MODE=false`, every monetisation/payment flag `false`,
   `PRIVATE_BETA_REQUIRE_STAFF_MFA=true`, and `IMAGE_PROCESSOR_MODE=disabled`.
4. Deploy staging a second time and verify the deployment ID, `/robots.txt`,
   the sitemap `404`, authentication
   denial, the staging-only `workers.dev` address, and the CI configuration
   contract that keeps all billing flags disabled before adding any provider
   integrations.
5. Record the known-good Cloudflare deployment ID.

If verification fails, stop provider testing. Roll back only to the explicitly
recorded known-good Cloudflare deployment. When there is no previous known-good
version, disable public access to the staging `workers.dev` endpoint until a
corrected build passes. Never enable demo mode, point staging at production
data, reset Supabase, or mutate migration history as a rollback technique. If a
database migration was already applied, keep the database forward-only and use
a compatible application rollback or a new corrective migration.

### Roll back hosted staging in this order

1. Stop manual GitHub dispatches and provider tests. Record the active Worker
   deployment, tested Git SHA, request IDs, and relevant sanitized logs.
2. If a functional known-good Worker deployment has been recorded, roll the
   Worker back to that exact deployment and repeat the authentication,
   crawler, demo-mode, and security smoke checks.
3. If no functional known-good deployment exists, keep the application
   fail-closed or disable the public `workers.dev` endpoint. The recorded
   Worker version `75593db4-12fd-486d-ae8a-bdf9ebbb3ece` is the safe `503`
   bootstrap baseline.
4. Do not reverse a hosted database migration with reset, repair, drop,
   truncate, or migration-history edits. Use a compatible application version
   or add a reviewed forward-only corrective migration.
5. If a catalogue seed fails, confirm that its transaction rolled back before
   retrying. Do not partially patch catalogue rows by hand.
6. If credential exposure is suspected, revoke or rotate the affected
   provider credential before redeploying. Update only the secret store that
   owns it.
7. After recovery, repeat hosted smoke tests and record the new deployment ID
   and tested Git SHA before resuming provider work.

## Connect the hosted Supabase staging project

### Mandatory read-only inventory and stop conditions

Use only project `perfume-marketplace-bg-staging`, ref
`nuhkpqjjyuygiemrxbdp`, in organization `khazvscqabwvslnphbqp` and Frankfurt
region `eu-central-1`. Before linking, seeding, or applying migrations, record
and verify all of the following:

- organization, project name, project ref, project URL, region, and intended
  staging owner;
- existing migration history and every non-system schema/table/view/function,
  trigger, extension, RLS policy, scheduled job, Realtime publication, Storage
  bucket/object, Edge Function, webhook, and secret name;
- counts for `auth.users`, application tables, and `storage.objects`;
- Auth public-signup setting, Site URL, redirect allow-list, email provider
  state, and MFA policy;
- whether any row, user, object, or log indicates real or production data.

Stop immediately if the project identity or region is wrong; any unexpected
infrastructure migration or application object exists; any auth user, Storage object, or
non-synthetic application row exists; the signup setting differs from the documented target;
the project appears shared with another application; or permissions prevent a
complete inventory. Preserve the read-only evidence and investigate before changing it.

Remote reset and repair operations are not authorized. In particular, never
run `supabase db reset` against a linked/hosted project, never use
`supabase migration repair`, never drop/truncate schemas to make the inventory
look empty, and never rewrite an applied migration. `supabase db reset` is
local-only. A mismatch requires a new isolated staging project or a separately
approved forward-only remediation plan.

Run the guarded commands from the trusted local shell:

```powershell
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
pnpm db:staging:push
pnpm seed:staging
pnpm db:staging:types
pnpm db:staging:types:check
```

Each command rechecks the official link, project inventory, region, health,
PostgreSQL major version, URL, and project-bound key before it can mutate
hosted state. Type generation is pinned to the same project ref and public
schema; `db:staging:types:check` fails when the committed generated types differ
from the hosted result. Do not substitute a raw linked `db push`, unguarded
seed, or remote reset/repair.

The accepted hosted result is migration history `001`–`010`, 4 empty Storage
buckets, 12 Realtime publication tables, 2 scheduled jobs, 0 Auth users or
identities, and 0 Storage objects. The catalogue counts are 196 brands, 48
aliases, and 335 memberships with exact `80/80/80/80/15` collections.

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | Public project URL | Browser/server Supabase clients, catalogue seed, storage backup, and restore | Required for the first connected staging Worker |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible key | Browser/server Supabase clients | Required for the first connected staging Worker |
| `SUPABASE_SECRET_KEY` | Secret | Worker server actions, admin invitations, uploads, backup, and restore | Required for the real application flow; never expose it to browser code |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase Edge Functions, catalogue seed, and legacy server fallback | Required before deploying `notification-email`, `upload-cleanup`, or seeding; otherwise defer it |
| `PUBLIC_SUPABASE_ANON_KEY` | Legacy browser-visible fallback | Legacy/local Supabase compatibility | Leave unset when `PUBLIC_SUPABASE_PUBLISHABLE_KEY` is available |
| `SUPABASE_URL` | Provider runtime value | `notification-email` and `upload-cleanup` Edge Functions | Verify it is available in the hosted Edge Function environment before testing those functions |

`PUBLIC_SUPABASE_PUBLISHABLE_KEY` is browser-visible, but it is not one of the
two GitHub repository secrets used by the current manual staging workflow.
Configure it on the staging Worker. Row Level Security remains the access
boundary.

For this baseline, `PUBLIC_SUPABASE_URL` must equal
`https://nuhkpqjjyuygiemrxbdp.supabase.co`. The staging target guard verifies
that URL and the browser-safe publishable key against the Frankfurt ref without
printing either value. The Worker-only `SUPABASE_SECRET_KEY` is verified
separately by the staging `/login` backend attestation: it must read the exact
`196/48/335` catalogue counts from that origin or the route fails closed with
`503`. The key and provider error details are never returned to the browser or
written to application logs.

Keep the hosted staging project isolated from production and populate it only
with synthetic people and listings. Apply migration `012`, then enable public
email/password signup before testing registration.

### Gate 3 A9 synthetic-actor runner

The only executable A9 composition entrypoint is:

```powershell
pnpm a9:staging:provision
```

It remains disabled unless every A9 lock is exact. The runner validates all
configuration before constructing inert clients, re-runs the Frankfurt target
and hosted Auth-policy preflight before the first mutation, uses
`PUBLIC_SUPABASE_URL` plus `SUPABASE_SECRET_KEY` for the one privileged client,
and creates a fresh non-persistent client with
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` for every actor session. The legacy
`SUPABASE_SERVICE_ROLE_KEY` is required only for the target-locking API-key
inventory check; it is not used to construct the privileged A9 client.
Before constructing either client, the runner exclusively reserves both an
empty manifest and an authenticated empty credential store. Both configured
paths must have the same pre-created parent directory and neither final file
may already exist. Any collision stops A9 without replacing owner data. A
verified transaction rollback removes the empty reservations; an unconfirmed
rollback preserves them as retry evidence.
The reserved manifest contains a runtime-generated opaque attempt ID and a
SHA-256 identity for the canonical credential-store path. Before each Auth
create, A9 checkpoints a role-only pending intent. This gives A11 exact,
non-secret recovery coordinates if the process stops after provider commit but
before the user ID checkpoint, and prevents parallel attempts from deleting
one another's actor.

Required A9 names are:

| Name | Classification | Exact rule and lifecycle |
|---|---|---|
| `APP_ENV` | Non-secret gate | Exact `staging`; process-scoped |
| `E2E_REAL_RUN` | Non-secret gate | Exact `true`; process-scoped |
| `E2E_REAL_REPORT_EVIDENCE_RUN` | Non-secret gate | Exact `true`; process-scoped |
| `E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN` | Non-secret gate | Exact `true`; remove after A9 |
| `E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL` | Non-secret gate | Exact `A9`; remove after A9 |
| `E2E_REAL_REPORT_EVIDENCE_RUN_ID` | Sensitive provenance | `gate3-` plus 8–64 lowercase letters, digits, or hyphens; keep through A11 |
| `E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE` | Sensitive provenance | Owner-generated UUID unique to this A9 run; keep through A11 |
| `E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER` | Sensitive provenance | Exact millisecond ISO-8601 lower bound for fresh actors; keep through A11 |
| `E2E_REAL_BASE_URL` | Non-secret target | Exact staging Worker HTTPS origin |
| `EXPECTED_SUPABASE_PROJECT_REF` | Non-secret target | Exact Frankfurt staging ref |
| `PUBLIC_SUPABASE_URL` | Non-secret target | Exact Frankfurt staging Supabase origin |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Non-secret browser key | Current project-bound publishable key |
| `SUPABASE_ACCESS_TOKEN` | Secret | Supabase management inventory only; process-scoped |
| `SUPABASE_SECRET_KEY` | Secret | Privileged A9 client; process-scoped and never browser-visible |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Legacy API-key inventory attestation only; process-scoped |
| `E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH` | Sensitive local path | Absolute `.json` path outside the repository in the hardened run directory; keep through A11 |
| `E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH` | Sensitive local path | Absolute `.enc` path outside the repository in the hardened run directory; keep through A11 |
| `E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY` | Secret | At least 32 characters, loaded only into the trusted process and stored separately from the `.enc` file; keep through A11, then destroy |

Each of the four exact actors also requires an owner-generated synthetic
email, password, and unique username:

```text
E2E_REAL_REPORTER_EMAIL
E2E_REAL_REPORTER_PASSWORD
E2E_REAL_REPORTER_USERNAME
E2E_REAL_CROSS_USER_EMAIL
E2E_REAL_CROSS_USER_PASSWORD
E2E_REAL_CROSS_USER_USERNAME
E2E_REAL_ASSIGNED_MODERATOR_EMAIL
E2E_REAL_ASSIGNED_MODERATOR_PASSWORD
E2E_REAL_ASSIGNED_MODERATOR_USERNAME
E2E_REAL_UNASSIGNED_MODERATOR_EMAIL
E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD
E2E_REAL_UNASSIGNED_MODERATOR_USERNAME
```

Emails must be syntactically valid and unique, passwords must contain 12–128
characters, and usernames must be unique 3–40 character values containing
only letters, numbers, `_`, `.`, or `-`. A9 proves every configured email is
absent immediately before its create attempt. It refuses to reuse or delete a
prior actor, including an actor from a previous attempt with the same run
provenance.

The owner never supplies TOTP seeds. Supabase generates each seed during the
actor-owned enrollment. The runner immediately writes it to the run-scoped
credential store using the repository's scrypt-derived AES-256-GCM pattern.
The file is atomically replaced, hardened to owner-only access, and contains
only authenticated ciphertext. The manifest is also atomically written with
owner-only access and never contains credentials.

A10 reopens the same encrypted store with the same path and key and retrieves
one exact moderator seed only while generating the current challenge code.
A11 first verifies scoped hosted cleanup, then authenticates and purges the
credential store, and only then removes the manifest. A failed A9 enrollment
or later A9 compensation deletes that role's stored seed; a failed A11 store
authentication, missing file, or unreadable file leaves the manifest in place
for a safe retry. Missing is never treated as proof of purge while the manifest
still exists.
Purge atomically replaces the credential ciphertext with an authenticated
empty tombstone bound to the original canonical path. A manifest-removal retry
can authenticate that tombstone without restoring a seed; after manifest
removal the runner removes the tombstone. If that final unlink fails, the same
A11 entrypoint accepts only the absent-manifest plus authenticated empty
tombstone state and retries the unlink; missing, unreadable, unauthenticated,
or active stores still fail closed. Copying the encrypted file to a different
configured path fails authentication.

Never set or persist either of these obsolete plaintext inputs:

```text
E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET
E2E_REAL_UNASSIGNED_MODERATOR_TOTP_SECRET
```

Do not put actor passwords, Supabase credentials, or the TOTP encryption key
in `.env`, `.env.local`, tracked files, command arguments, shell history,
logs, Playwright artifacts, issue/PR text, or chat. The two paths and non-secret
gate values may be process variables. Keep the encryption key in a separate
password/secret system from the encrypted run directory. Pre-create that
directory outside the repository with inheritance removed and access granted
only to the operator account; the runner additionally applies owner-only ACLs
to every atomic file replacement.

### Enable hosted email/password Auth for registration testing

The Frankfurt staging Auth configuration is:

- public email/password signup: currently disabled and must be enabled after migration `012`;
- anonymous signup: disabled;
- email confirmation: enabled;
- Site URL:
  `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev`;
- redirect allow-list:
  `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev/auth/callback`
  and
  `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev/auth/confirm`;
- custom SMTP and CAPTCHA: unconfigured; no SMS provider is required.

Do not run `supabase config push` against this project. The local Supabase
configuration contains localhost callback values and an SMS test OTP that must
never replace the hosted Auth settings.

### First administrator bootstrap

Migration `008_first_admin_bootstrap` adds the only exception to the normal
“active administrator creates invitations” rule. Its two public RPC contracts
are service-role-only, tokenless and one-time:

- `prepare_first_admin_invite(email, valid_for)` creates or safely reuses the
  audited pending bootstrap marker;
- `bind_first_admin_invite(invite_id, user_id)` binds that exact marker to the
  authoritative Supabase Auth invitation.

The binding creates only a pending beta membership. It does not accept Terms,
Privacy or Marketplace Rules for the administrator, and it does not bypass
email confirmation, onboarding or staff MFA.

Run the trusted operator only from a local shell after the hosted migration,
Auth callback allow-list and real email transport have been verified. Never
store its service-role key or operator values in GitHub or Worker
configuration:

```powershell
$env:APP_ENV='staging'
$env:FIRST_ADMIN_BOOTSTRAP_ENABLED='true'
$env:FIRST_ADMIN_EMAIL_TRANSPORT_CONFIRMED='true'
$env:FIRST_ADMIN_EMAIL='operator@example.com'
pnpm bootstrap:first-admin -- prepare
```

If Auth delivery fails before a user is created, the script revokes the pending
database marker as compensation. If delivery succeeds but binding fails, the
marker remains pending and the script prints only the non-secret invite/user
recovery IDs. Retry without resending email:

```powershell
$env:FIRST_ADMIN_BOOTSTRAP_INVITE_ID='<reported invite UUID>'
$env:FIRST_ADMIN_BOOTSTRAP_USER_ID='<reported user UUID>'
pnpm bootstrap:first-admin -- bind
```

The bind-only retry needs the staging Supabase URL, service-role key and the two
UUIDs, but it does not depend on Resend, the callback origin or currently
working email transport.

Do not run this operator in the current infrastructure-only staging phase:
Resend/Auth email delivery is deliberately deferred. It rejects every
environment except `APP_ENV=staging`, and a successfully bound bootstrap is
terminal.

## Add Resend before testing registration emails and notifications

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `RESEND_API_KEY` | Secret | `notification-email` Edge Function and transactional email provider | Required before registration-email and notification tests; defer for the first infrastructure-only deploy |
| `RESEND_FROM_EMAIL` | Public sender configuration | `notification-email` and the verified sender setup | Required with `RESEND_API_KEY` |
| `NOTIFICATION_WEBHOOK_SECRET` | Secret, at least 32 bytes | Header shared by the Supabase notification webhook and `notification-email` | Required before enabling the notification webhook; use a staging-only value |

Configure the verified Resend sender in Supabase Auth for authentication email.
Deploy the notification function only after its Resend values and
`SUPABASE_SERVICE_ROLE_KEY` are available.

## Add Turnstile before testing protected forms

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `PUBLIC_TURNSTILE_SITE_KEY` | Browser-visible site key | Login and protected form UI | Required before hosted Turnstile testing |
| `TURNSTILE_SECRET_KEY` | Secret | Server-side Turnstile verification | Required at the same time as the site key |
| `TURNSTILE_EXPECTED_HOSTNAME` | Public hostname configuration | Server-side hostname validation | Set it to the hostname from `PUBLIC_APP_URL` |

These values can be deferred for an infrastructure-only deploy. They are
required before the staging login, password-reset, and sensitive
form security tests.

## Set application, consent, and safety values

| Name | Classification | Staging value or rule | When it is required |
|---|---|---|---|
| `APP_ENV` | Private environment label | `staging` | Set for the hosted staging Worker |
| `PUBLIC_DEMO_MODE` | Public build/runtime flag | `false` | Required from the first staging deploy |
| `PUBLIC_APP_URL` | Public HTTPS origin | Exact staging Worker origin | Required before registration callbacks and email links |
| `PRIVATE_BETA_REQUIRE_STAFF_MFA` | Private policy flag | `true` | Required from the first staging deploy |
| `TERMS_VERSION` | Public consent version | Exact version shown by the deployed Terms page | Required before onboarding tests |
| `PRIVACY_VERSION` | Public consent version | Exact version shown by the deployed Privacy page | Required before onboarding tests |
| `MARKETPLACE_RULES_VERSION` | Public consent version | Exact version shown by the deployed Rules page | Required before onboarding tests |
| `LEGAL_CONTENT_APPROVED` | Private release flag | Keep `false` until the published text is approved | May remain `false` for internal staging; must not be used to imply legal approval |
| `INCIDENT_CONTACT_EMAIL` | Public operational contact | Monitored staging/safety contact | Required before external invitations |

Consent version values are identifiers recorded with the accepted text. Change
them whenever the corresponding published document changes.

## Configure notifications, cleanup, and backups before exercising them

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `UPLOAD_CLEANUP_SECRET` | Secret, at least 32 bytes | Header shared by the scheduler and `upload-cleanup` Edge Function | Required before enabling the cleanup schedule |
| `UPLOAD_CLEANUP_BATCH_SIZE` | Private operational setting | Cleanup Edge Function | Optional; default is `25`, allowed range is `1`–`100` |
| `FINALIZED_IMAGE_BUCKET` | Private storage setting | Finalized-image backup script | Optional; default is `listing-images` |
| `BACKUP_ENCRYPTION_KEY` | Offline secret, at least 32 characters | Storage backup and restore scripts only | Required before the first storage backup or restore rehearsal |
| `BACKUP_DIRECTORY` | Local path setting | Storage backup script only | Optional; default is `.backups` |

Never configure `BACKUP_ENCRYPTION_KEY` as a Worker secret. Keep it in a
separate secrets system from the encrypted backup set. Storage backup and
restore also require `PUBLIC_SUPABASE_URL` and either
`SUPABASE_SECRET_KEY` or the legacy `SUPABASE_SERVICE_ROLE_KEY`.

## Keep monetisation and payments disabled

## Durable credential boundaries

Credentials are required only for an explicitly authorized hosted operation. Never copy production credentials into staging or store real secrets in committed environment files, configuration, documentation, source, pull-request-visible variables, logs, screenshots, or receipts. Current migration tips, Auth counts, Storage counts, Worker IDs, rollback versions, and provider activation state are intentionally volatile and belong in `PROJECT-STATUS.md` or gate evidence, not in this credential checklist.

Set every staging monetisation flag to `false`:

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

Do not provision `MYPOS_SID`, `MYPOS_WALLET_NUMBER`, `MYPOS_KEY_INDEX`,
`MYPOS_CHECKOUT_URL`, `MYPOS_PRIVATE_KEY`, `MYPOS_PUBLIC_CERTIFICATE`,
`STRIPE_SECRET_KEY`, or `STRIPE_WEBHOOK_SECRET` for this staging phase.
Payments, fees, subscriptions, boosts, and advertising remain out of scope.

## Finish the baseline before adding providers

1. Run the full local test/audit matrix, PostgreSQL checks, and both Wrangler
   dry-runs sequentially.
2. Push the reviewed branch, require green application and database quality
   jobs, and merge only that tested state to `main`.
3. Manually dispatch `deploy staging` for the exact `main` SHA. The workflow
   must deploy only staging and run the hosted HTTP smoke automatically.
4. Verify the smoke receipt covers public login/legal/safety `200` responses,
   protected-route `303` redirects, closed `robots.txt`, missing sitemap,
   security/no-store headers, no demo data, and fail-closed login without
   Turnstile.
5. Fill the first functional deployment receipts near the top of this
   document, commit them, then deploy the resulting documentation SHA so the
   active Worker and final `main` agree. Keep that final receipt in the
   immutable GitHub Actions and Cloudflare deployment records.
6. If functional smoke fails, the workflow automatically restores Worker
   version `75593db4-12fd-486d-ae8a-bdf9ebbb3ece` and verifies its five-route
   fail-closed contract. Keep the database forward-only and investigate before
   another dispatch.
7. Start Resend, Turnstile, Cloudflare Images, real-provider E2E, and
   backup/restore work only in a separately approved phase.
8. Keep production, first-admin bootstrap, real users, external access,
   custom domain, legal approval, and every
   payment/monetisation capability gated.
> Historical hosted checkpoint details in this document are retained for guarded operational reference only. They do not assert current Auth, provider, migration, Worker, or environment state; current status requires fresh evidence in `docs/PROJECT-STATUS.md`.
