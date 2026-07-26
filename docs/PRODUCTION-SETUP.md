# Production setup for the closed beta

This runbook describes the engineering setup. It does not replace the legal, accounting or carrier approvals listed in `LAUNCH-GATES.md`.

## Current GitHub Free operating model

The canonical private repository for this phase is
`todevan/perfume-marketplace-bg`. The previous
`todevan/remix-of-scent-exchange` repository remains untouched and is not a
remote, migration source, deployment source, or backup.

The current GitHub Free model uses repository secrets and manual staging
dispatch only. It does not rely on protected branches, required status checks,
protected environments, or environment reviewers. Those controls may be added
later if the repository plan and team model support them. Until then:

- a successful push is not deployment authorization;
- staging is dispatched manually for the exact locally/CI-tested commit;
- only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are stored as GitHub
  repository secrets for staging;
- runtime provider secrets remain in their staging providers;
- production deployment and production GitHub credentials are not enabled.

The absence of GitHub enforcement does not relax the release contract. The
operator must verify the commit SHA, clean checks, inventory evidence, and
rollback target before each manual staging dispatch.

## Environments

Use three isolated Supabase projects/data sets:

| Environment | Data | Cloudflare Worker | Purpose |
|---|---|---|---|
| Local | synthetic only | local Wrangler/Vite | development and integration tests |
| Staging | synthetic test users | `perfume-marketplace-bg-staging` | migrations, E2E and invite rehearsal |
| Production | invited beta users | custom domain Worker | closed beta |

Never copy production personal data into local or staging. Use different Supabase secrets, Resend credentials, Turnstile keys and Twilio configuration in each environment.

## One-time account setup

1. Create hosted Supabase staging and production projects in Frankfurt on the required paid plan.
2. Disable public signup, configure the verified Resend auth SMTP sender and set the Site URL plus exact redirect allow-list.
3. Configure Twilio Verify/SMS for `+359` only. Test A1, Yettel and Vivacom before inviting users.
4. Create Cloudflare staging and production Workers. Configure a custom production domain before sending external invitations.
5. Configure Cloudflare Images for private originals and sanitized JPEG/WebP derivatives. Do not enable uploads while `IMAGE_PROCESSOR_MODE=disabled`.
6. Require MFA for every admin and moderator in both Supabase and the upstream administrative accounts.
7. Deploy `notification-email` and `upload-cleanup`, store their provider/scheduler secrets with `supabase secrets set`, then create an **INSERT-only** Database Webhook for `public.notifications`. Send `x-webhook-secret`; never put a service key in the webhook header.

## Secrets and configuration

Start from `.env.example` and use the [staging credentials checklist](STAGING-CREDENTIALS.md) when connecting the external services. Local `.env*` files are ignored. Put hosted Worker secrets in Cloudflare, not in `wrangler.jsonc` or GitHub variables visible to pull requests.

`wrangler.jsonc` uses `keep_vars: true`, so a code deployment preserves the secrets and variables provisioned for that Worker environment. Treat the Cloudflare environment settings as controlled infrastructure: record every required key from `.env.example`, restrict who may change it, and verify the deployed values after each rotation.

Production invariants:

- `PUBLIC_DEMO_MODE=false` and `PRIVATE_BETA_REQUIRE_INVITE=true`;
- `PRIVATE_BETA_REQUIRE_STAFF_MFA=true`;
- `FEATURE_SMS_VERIFICATION_ENABLED=true`;
- every billing, fee, subscription, boost, advertising and payment flag is `false`;
- `PAYMENT_PROVIDER=disabled`;
- `IMAGE_PROCESSOR_MODE=cloudflare-images` only after the sanitizer passes its acceptance tests;
- `LEGAL_CONTENT_APPROVED=true` only after the actual published versions are approved.
- `NOTIFICATION_WEBHOOK_SECRET` is a unique random value of at least 32 bytes and differs between staging and production.

Run the fail-closed gate before deployment:

```bash
pnpm check:release -- --env-file=.env.production
```

The command checks secrets/configuration, disabled monetisation, the six
forward-only migrations `003`–`008` and required legal routes. It intentionally
fails on a fresh checkout.

## Migration and catalogue order

1. Inventory the intended hosted staging project read-only as defined in
   `STAGING-CREDENTIALS.md`; stop on an identity, region, history, object, user,
   Storage, configuration, or permissions mismatch.
2. Run `supabase db reset` locally and `supabase test db` when Docker is
   available. This reset is local-only.
3. Apply all migrations to the verified empty staging project without editing
   `001` or `002`.
4. Re-inventory the remote migration history and schema, then run the live
   RLS/concurrency test suite against synthetic staging accounts.
5. Run `pnpm seed:catalog` from a trusted server environment.
6. Exercise the full Playwright flow with buyer, seller and moderator only
   after its required providers are configured.
7. Take and verify a production backup before applying the same migrations to
   production.

Database migrations are forward-only. A failed hosted migration is repaired with a new migration; do not rewrite an already applied file.
Do not use linked/remote `db reset`, migration repair, schema drops, truncation,
or history rewriting. If remote state differs from the recorded inventory,
stop and choose either a new isolated staging project or an explicitly approved
forward-only remediation.

## Staging bootstrap sequence

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:e2e
pnpm exec wrangler deploy --dry-run --env staging
```

After the read-only provider inventories pass, use local Wrangler
authentication for the first explicit `--env staging` deploy. This creates the
staging Worker and may safely return an application `503` until its Supabase
runtime values exist. Configure that Worker, deploy a second time, and record
the first known-good deployment ID only after `/robots.txt` denies indexing,
`/sitemap.xml` returns 404, unauthenticated private routes fail closed, demo
mode is off, and billing flags are still false.

Only then add the two Cloudflare repository secrets and manually dispatch
staging for the exact tested `main` commit. Capture the known-good deployment
ID before every later dispatch and repeat the same smoke checks.

If the application or security smoke test fails, roll Cloudflare back only to
the recorded known-good deployment. If no known-good version exists, disable
the public staging endpoint. Do not reset or repair Supabase as part of an
application rollback. Applied database changes remain forward-only.

Production deployment is not part of the current GitHub Free bootstrap. It
remains blocked until the provider, backup/restore, domain, legal, carrier,
security, and external-invite gates are satisfied.

Trigger one notification of every supported kind in staging and verify both the in-app record and the Resend delivery log. The Edge Function resolves the recipient email through Supabase Auth, sends only a generic notification payload, validates same-origin action links and uses the notification UUID as Resend's idempotency key. Database Webhooks are asynchronous, so provider failure must be visible in function logs and the delivery ledger before launch.

Deploy `upload-cleanup` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and a per-environment `UPLOAD_CLEANUP_SECRET` of at least 32 random bytes; optionally set `UPLOAD_CLEANUP_BATCH_SIZE` to `1`–`100` (default `25`). Configure exactly one scheduler per environment to send `POST /functions/v1/upload-cleanup` with `x-upload-cleanup-secret` every five minutes, retry `5xx` responses with backoff, and never place the secret in the URL. The database lease makes overlapping invocations safe; monitor failed/dead-letter counts without logging private object paths.

## Invite ramp

Invite internal accounts first. When error rate, abuse queue and delivery metrics remain clean, invite 10 users, then 30–50. Stop the ramp for any P0/P1 issue, cross-account data access, unreviewed moderation access, lost upload, failed restore, or unexpected billing path.
