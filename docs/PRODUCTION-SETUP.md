# Production setup for the closed beta

This runbook describes the engineering setup. It does not replace the legal, accounting or carrier approvals listed in `LAUNCH-GATES.md`.

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

The command checks secrets/configuration, disabled monetisation, the five forward-only migrations and required legal routes. It intentionally fails on a fresh checkout.

## Migration and catalogue order

1. Back up staging.
2. Run `supabase db reset` locally and `supabase test db` when Docker is available.
3. Apply all migrations to staging without editing `001` or `002`.
4. Run the live RLS/concurrency test suite against staging test accounts.
5. Run `pnpm seed:catalog` from a trusted server environment.
6. Exercise the full Playwright flow with buyer, seller and moderator.
7. Take and verify a production backup before applying the same migrations to production.

Database migrations are forward-only. A failed hosted migration is repaired with a new migration; do not rewrite an already applied file.

## Deploy sequence

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:e2e
pnpm check:release -- --env-file=.env.production
pnpm deploy
```

After deployment, verify `/robots.txt` denies indexing, `/sitemap.xml` returns 404, unauthenticated private routes redirect to login, invite consumption is one-time, uploads cannot expose originals, and billing flags are still false.

Trigger one notification of every supported kind in staging and verify both the in-app record and the Resend delivery log. The Edge Function resolves the recipient email through Supabase Auth, sends only a generic notification payload, validates same-origin action links and uses the notification UUID as Resend's idempotency key. Database Webhooks are asynchronous, so provider failure must be visible in function logs and the delivery ledger before launch.

Deploy `upload-cleanup` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and a per-environment `UPLOAD_CLEANUP_SECRET` of at least 32 random bytes; optionally set `UPLOAD_CLEANUP_BATCH_SIZE` to `1`–`100` (default `25`). Configure exactly one scheduler per environment to send `POST /functions/v1/upload-cleanup` with `x-upload-cleanup-secret` every five minutes, retry `5xx` responses with backoff, and never place the secret in the URL. The database lease makes overlapping invocations safe; monitor failed/dead-letter counts without logging private object paths.

## Invite ramp

Invite internal accounts first. When error rate, abuse queue and delivery metrics remain clean, invite 10 users, then 30–50. Stop the ramp for any P0/P1 issue, cross-account data access, unreviewed moderation access, lost upload, failed restore, or unexpected billing path.
