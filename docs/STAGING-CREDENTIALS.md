# Staging credentials and configuration

Use this checklist when connecting the staging Cloudflare Worker to the hosted
services. It covers the values that already exist in `.env.example`, the
deployment workflow, and the current backup and Edge Function scripts.

No provider credentials are required for local tests, dependency audits,
Cloudflare configuration validation, or either
`wrangler deploy --dry-run` command. Real credentials are needed only when a
hosted staging service is connected or deployed.

Do not copy production credentials into staging. Store secrets in the provider
or the GitHub `staging` environment, never in `wrangler.jsonc`, a committed
`.env` file, or a pull-request-visible GitHub variable.

## Connect Cloudflare first

| Name or binding | Classification | Where it is used | When it is required |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | GitHub staging deployment job and real Wrangler deploy | Required for the first real staging deploy; not required for dry-runs |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier | GitHub staging deployment job and the production-readiness contract | Required for the first real staging deploy |
| `IMAGES` | Cloudflare binding, not a secret | Worker upload route through the staging `wrangler.jsonc` environment | Required before enabling the Cloudflare Images processor |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Secret | Images provisioning/operations and the production-readiness contract; the application upload route uses the `IMAGES` binding instead | Can be deferred until the image pipeline is configured and tested |
| `IMAGE_PROCESSOR_MODE` | Private runtime configuration | Worker upload pipeline | Keep `disabled` for the first deploy; change to `cloudflare-images` only after the binding and sanitizer pass their tests |

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub
**Environment secrets** for `staging`. Configure the remaining application
variables and secrets on the `perfume-marketplace-bg-staging` Worker. The
current Wrangler configuration uses `keep_vars: true`, so a code deploy
preserves values already provisioned on that environment.

The staging `workers.dev` address is intentionally available for internal
testing. `PUBLIC_APP_URL` must use the exact HTTPS origin assigned to that
Worker, with no path, query, or fragment.

## Connect the hosted Supabase staging project

| Name | Classification | Where it is used | When it is required |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | Public project URL | Browser/server Supabase clients, catalogue seed, storage backup, and restore | Required for the first connected staging Worker |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible key | Browser/server Supabase clients | Required for the first connected staging Worker |
| `SUPABASE_SECRET_KEY` | Secret | Worker server actions, admin invitations, uploads, backup, and restore | Required for the real application flow; never expose it to browser code |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase Edge Functions, catalogue seed, and legacy server fallback | Required before deploying `notification-email`, `upload-cleanup`, or seeding; otherwise defer it |
| `PUBLIC_SUPABASE_ANON_KEY` | Legacy browser-visible fallback | Legacy/local Supabase compatibility | Leave unset when `PUBLIC_SUPABASE_PUBLISHABLE_KEY` is available |
| `SUPABASE_URL` | Provider runtime value | `notification-email` and `upload-cleanup` Edge Functions | Verify it is available in the hosted Edge Function environment before testing those functions |

Although the current GitHub production workflow stores
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` as a GitHub secret, it is a browser-visible
publishable key, not a server secret. Row Level Security remains the access
boundary.

Keep the hosted staging project isolated from production and populate it only
with synthetic people and listings. Disable public signup in Supabase Auth
before testing invitations.

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
2. Provision `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the GitHub
   `staging` environment.
3. Add the Supabase URL, publishable key, and server secret plus the closed-beta
   application flags to the staging Worker.
4. Perform the first real staging deploy with image processing and SMS still
   disabled.
5. Add Turnstile, Resend, notification, and cleanup secrets before testing
   their corresponding flows.
6. Add the Twilio values and enable SMS verification only for the planned
   `+359` carrier tests.
7. Configure Cloudflare Images and backups, run their acceptance/recovery
   tests, then enable `IMAGE_PROCESSOR_MODE=cloudflare-images`.

