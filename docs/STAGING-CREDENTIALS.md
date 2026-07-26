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

Checkpoint date: 2026-07-26. This is an infrastructure-only, fail-closed
checkpoint. It is not a usable beta environment and must not receive external
invitations.

| Area | Verified state |
|---|---|
| GitHub | `todevan/perfume-marketplace-bg` exists as the new canonical private repository. The older `todevan/remix-of-scent-exchange` repository remains untouched. |
| Quality CI | GitHub Actions run `30201952581` is green for both application and database jobs on commit `ba135edb432dc30d958624c236c3e28a36a02831`. |
| Local database | The disposable local stack now matches hosted PostgreSQL major version 17. Migrations `001`–`009` apply locally, SQL lint is clean, and all 111 pgTAP assertions pass. |
| Local catalogue | The atomic seed contains 196 brands, 48 aliases, and 335 editorial memberships. Membership counts are exactly 80 men, 80 women, 80 unisex, 80 niche, and 15 Arabic. |
| Cloudflare account | Account ID `0cb7373563c400a08bd46564320dd747` owns the staging Worker. |
| Cloudflare Worker | `perfume-marketplace-bg-staging` is available at `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev`. |
| Fail-closed deployment | Manual GitHub run `30202089147` deployed commit `ba135edb432dc30d958624c236c3e28a36a02831` as Cloudflare version `f7488f01-40cf-4605-bc6a-9746f56f0044`, deployment `6701b6ad-718c-4a30-92e4-622bc346eead`. It returns the expected `503` while Supabase runtime configuration is absent. `/`, `/login`, `/dashboard`, `/robots.txt`, and `/sitemap.xml` were checked, and no demo content was exposed. |
| Hosted Supabase | Read-only inventory completed for project `zllqwlekadiuyejgbuxc`: zero Auth users, zero Storage buckets/objects, no application tables/views, no migration history, and only the platform-default `public.rls_auto_enable` function. The hosted database is PostgreSQL 17.6. The project is intentionally still unlinked and unmodified because its region is `eu-north-1` (Stockholm), not the required `eu-central-1` (Frankfurt). |
| Configured Worker | Blocked on a Frankfurt Supabase project or an explicit region-requirement change. The deployed `503` version is a safe bootstrap baseline, not the first functional known-good application version. |
| GitHub staging deploy | A separate account-scoped Cloudflare token with only Workers Scripts Write was created, verified and stored as `CLOUDFLARE_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` is also present. The first manual `workflow_dispatch` run `30202089147` completed successfully for the exact approved `main` SHA, and its logs contained no raw-token patterns. This proves the GitHub-to-Cloudflare path only; it is not a functional beta acceptance result. |
| External providers | Resend, Turnstile, Cloudflare Images processing, Twilio, real-provider E2E, and backup/restore rehearsal remain deferred. |
| Production | Locked. No production project, route, secret, deployment, domain, user, invitation, or payment capability is authorized by this checkpoint. |

Do not link or mutate project `zllqwlekadiuyejgbuxc` while the Frankfurt
requirement remains active. Continue only with a new empty Frankfurt project,
or after an explicit decision changes the region requirement. The manual
GitHub-to-Cloudflare transport is verified, but the Worker must not be marked
functional from that result. A functional known-good Worker still requires the
remote Supabase configuration, application smoke checks and recorded
deployment evidence.

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
  secret; configure browser-safe Supabase values and feature flags as Worker
  variables.
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
| Supabase | Project **Connect** or **Settings → API Keys** | Publishable key and server secret; copy them only into their intended secret store |
| Supabase | Project **Authentication → URL Configuration** | Exact Site URL and allowed `/auth/callback` and `/auth/confirm` redirects |
| Supabase | Project **Authentication → Sign In / Providers → Email** | Public signup disabled and email confirmation enabled |
| Supabase | Project **Authentication → Users** and **Storage** | Mandatory pre-migration zero-user/zero-object inventory |

The trusted local shell owns the Supabase CLI access token, database password,
legacy service-role key when required by operator tooling, and first-admin
bootstrap values. They do not belong in GitHub, Cloudflare Worker variables or
committed files. GitHub owns only the two least-privilege Cloudflare deployment
values listed above.

## Connect Cloudflare first

| Name or binding | Classification | Where it is used | When it is required |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | GitHub staging deployment job and real Wrangler deploy | Required for the first real staging deploy; not required for dry-runs |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier | GitHub staging deployment job and the production-readiness contract | Required for the first real staging deploy |
| `IMAGES` | Cloudflare binding, not a secret | Worker upload route through the staging `wrangler.jsonc` environment | Required before enabling the Cloudflare Images processor |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Secret | Images provisioning/operations and the production-readiness contract; the application upload route uses the `IMAGES` binding instead | Can be deferred until the image pipeline is configured and tested |
| `IMAGE_PROCESSOR_MODE` | Private runtime configuration | Worker upload pipeline | Keep `disabled` for the first deploy; change to `cloudflare-images` only after the binding and sanitizer pass their tests |

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub
**repository secrets** in `todevan/perfume-marketplace-bg`. Configure the
remaining application variables and secrets on the
`perfume-marketplace-bg-staging` Worker. The current Wrangler configuration
uses `keep_vars: true`, so a code deploy preserves values already provisioned
on that Worker.

The staging `workers.dev` address is intentionally available for internal
testing. `PUBLIC_APP_URL` must use the exact HTTPS origin assigned to that
Worker, with no path, query, or fragment.

### Cloudflare inventory, bootstrap, and rollback gate

Before the first real deploy, inventory the Cloudflare account, Worker names,
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
   `PUBLIC_DEMO_MODE=false`, invite-only access enabled, every
   monetisation/payment flag `false`, `FEATURE_SMS_VERIFICATION_ENABLED=false`,
   and `IMAGE_PROCESSOR_MODE=disabled`.
4. Deploy staging a second time and verify the deployment ID, `/robots.txt`,
   the sitemap `404`, authentication
   denial, billing flags, and the staging-only `workers.dev` address before
   adding any provider integrations.
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
   crawler, demo-mode, and billing smoke checks.
3. If no functional known-good deployment exists, keep the application
   fail-closed or disable the public `workers.dev` endpoint. The recorded
   `fb83c5a3-122a-41fa-8f22-9eca954567ed` deployment is only a safe `503`
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

Use the designated, staging-only Supabase project. Before linking, seeding, or
applying migrations, record and verify all of the following:

- organization, project name, project ref, project URL, region, and intended
  staging owner;
- existing migration history and every non-system schema/table/view/function,
  trigger, extension, RLS policy, scheduled job, Realtime publication, Storage
  bucket/object, Edge Function, webhook, and secret name;
- counts for `auth.users`, application tables, and `storage.objects`;
- Auth public-signup setting, Site URL, redirect allow-list, email/SMS provider
  state, and MFA policy;
- whether any row, user, object, or log indicates real or production data.

Stop immediately if the project identity or region is wrong; any unexpected
migration or application object exists; any auth user, Storage object, or
non-synthetic application row exists; public signup is enabled unexpectedly;
the project appears shared with another application; or permissions prevent a
complete inventory. Preserve the read-only evidence and ask for a decision.

Remote reset and repair operations are not authorized. In particular, never
run `supabase db reset` against a linked/hosted project, never use
`supabase migration repair`, never drop/truncate schemas to make the inventory
look empty, and never rewrite an applied migration. `supabase db reset` is
local-only. A mismatch requires a new isolated staging project or a separately
approved forward-only remediation plan.

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

Keep the hosted staging project isolated from production and populate it only
with synthetic people and listings. Disable public signup in Supabase Auth
before testing invitations.

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

## Add Resend before testing invitations and notifications

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `RESEND_API_KEY` | Secret | `notification-email` Edge Function and transactional email provider | Required before invitation/email notification tests; defer for the first infrastructure-only deploy |
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
required before the staging login, password-reset, phone OTP, and sensitive
form security tests.

## Add Twilio only when phone verification is ready

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `SUPABASE_AUTH_SMS_TWILIO_ACCOUNT_SID` | Secret account credential | Supabase Auth SMS configuration and operations | Required before real `+359` OTP tests |
| `SUPABASE_AUTH_SMS_TWILIO_MESSAGE_SERVICE_SID` | Secret service credential | Supabase Auth SMS configuration and operations | Required before real `+359` OTP tests |
| `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` | Secret | Supabase Auth SMS configuration and operations | Required before real `+359` OTP tests |
| `FEATURE_SMS_VERIFICATION_ENABLED` | Private feature flag | Application phone-verification flow | Keep `false` until Twilio is configured; set `true` for the planned staging carrier tests |

Twilio can be deferred during the initial Worker/Supabase smoke test. It is not
optional for the complete invite-to-review staging flow.

## Set application, consent, and safety values

| Name | Classification | Staging value or rule | When it is required |
|---|---|---|---|
| `APP_ENV` | Private environment label | `staging` | Set for the hosted staging Worker |
| `PUBLIC_DEMO_MODE` | Public build/runtime flag | `false` | Required from the first staging deploy |
| `PUBLIC_APP_URL` | Public HTTPS origin | Exact staging Worker origin | Required before invitations, callbacks, and email links |
| `PRIVATE_BETA_REQUIRE_INVITE` | Private policy flag | `true` | Required from the first staging deploy |
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

## Use this order for the next staging phase

1. Run local tests, audits, release-contract tests, and both Wrangler dry-runs
   without credentials.
2. Create and inspect the new private GitHub repository
   `todevan/perfume-marketplace-bg`; stop on unexpected remote history and
   leave `todevan/remix-of-scent-exchange` untouched.
3. Complete the read-only Supabase and Cloudflare inventories. Stop on every
   mismatch listed above; do not reset or repair a remote service.
4. Link and migrate only the verified empty Supabase staging project, then
   seed and verify the editorial catalogue.
5. Use local Wrangler authentication for the first explicit staging deploy,
   which creates the Worker and is expected to fail closed until configured.
6. Add the inventoried Supabase URL, publishable key, server secret and
   closed-beta flags to that Worker; deploy again and record the first
   known-good deployment ID.
7. Provision only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub
   repository secrets, then manually dispatch staging for the exact tested
   `main` commit and repeat the smoke checks.
8. Defer Turnstile, Resend, notification delivery, cleanup scheduling, Twilio,
   Cloudflare Images, and backup/restore acceptance until the baseline Worker
   and Supabase smoke tests are clean.
9. Keep production, external invitations, custom domain, legal approval,
   carrier tests, and every payment/monetisation capability gated.
