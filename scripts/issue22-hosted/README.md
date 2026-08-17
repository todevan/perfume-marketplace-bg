# Issue 22 isolated hosted operator

This tracked package is the sole reviewed execution path for the isolated Issue 22 hosted target. It must not be used before focused engineering and security review of the exact candidate SHA.

## Immutable scope

- Supabase project: `zzrrutwlrkhevellwork`, organization `khazvscqabwvslnphbqp`, `eu-central-1`, Free.
- Forbidden project: `nuhkpqjjyuygiemrxbdp`.
- Cloudflare account: `0cb7373563c400a08bd46564320dd747`.
- Dedicated Worker: `perfume-marketplace-bg-issue22`.
- Runtime mode remains `APP_ENV=staging` and binds the exact new project ref.

All executable code, configuration, tests, the migration/seed manifest, and the sanitized Cloudflare capacity receipt are tracked by Git. Only `private/` is ignored. The wrapper proves that directory has one non-inherited FullControl ACL for the current Windows user before secrets or recovery state can exist there.

## Non-mutating review commands

```powershell
& .\scripts\issue22-hosted\run-operator.ps1 -Mode migration-self-test
& .\scripts\issue22-hosted\run-operator.ps1 -Mode hosted-self-test
& .\scripts\issue22-hosted\run-operator.ps1 -Mode hosted-preflight
```

`preflight.ps1` is invoked by the execution wrapper. It does not reveal API keys. It rechecks exact HEAD/clean tracked bytes, the exact 18 migration hashes, catalogue input/implementation hashes, the tracked definition-fingerprint query hash, and fresh exact-account Workers usage/capacity. It accepts either a pristine empty target or the exact recovered baseline: all 18 reviewed versions; exact fingerprints for relation columns/defaults/constraints/indexes/RLS/ACLs (including NULL-versus-empty ACL state), types, function bodies/security/search paths/ACLs, public/private policies plus the application-owned `storage.objects` policies, triggers, and stable semantic catalogue/legal content; zero rows in every non-catalogue application table; catalogue `196/48/335`; four exact private buckets with zero objects; zero Auth users; cleared Auth credentials; and an immutable HMAC-authenticated baseline-adoption receipt bound to the one predecessor recovery/run/artifact chain. The HMAC key is the process-only Supabase CLI management credential and is never persisted or passed on a command line. The migrated baseline also requires the attributable secret-free rollback Worker metadata and empty secret inventory, but deliberately performs no request-generating smoke during preflight; the reviewed cleanup receipt is the rollback response proof. The pristine baseline requires the Worker identity to be unused. A process-memory `CLOUDFLARE_API_TOKEN` is mandatory for read-only capacity queries and is never written or printed. The tracked capacity receipt is historical review evidence only, never the execution gate. Sanitized live output is written only under protected ignored `private/`.

## Reviewed execution and recovery

After exact-SHA review only:

```powershell
& .\scripts\issue22-hosted\run-operator.ps1 -Mode hosted-execute -CandidateSha <40-character-reviewed-SHA>
```

Do not run lower-level files directly. The wrapper runs preflight, creates an append-before-mutation recovery intent, and executes one target-locked sequence:

1. write recovery intent, immediately disable and publicly attest signup quiescence, then create an in-memory pinned Ethereal SMTP account and a unique, pre-recorded hostname-bound Turnstile Free widget (`managed`, `no_clearance`, `world`);
2. keep signup disabled while `migration-runner.mjs` copies the unmodified `supabase` tree, proves link state before/after every linked command, performs fixed noninteractive dry-run/push/list commands, runs the repository-native atomic catalogue seed, and proves `196/48/335` before deployment;
3. deploy and smoke the attributable 503 rollback, inject secrets in memory, deploy/smoke the exact candidate, then open and attest email signup with confirmation required, phone/anonymous disabled, and Auth-boundary Turnstile;
4. run the protected-output Playwright journey with two browser SSR sessions, real emitted Ethereal links, browser CAPTCHA tokens, onboarding/access, hostile cross-user/role/city checks, and explicit session logout;
5. always run prioritized cleanup in `finally`.

Cleanup first rechecks exact candidate/clean tracked state and recovery attribution, then independently PATCHes and attests `disable_signup=true` before any credential-clearing request. It verifies the live Supabase `UpdateAuthConfigBody` nullable schema, clears CAPTCHA provider/secret and every `smtp_*` credential with JSON `null`, and positively re-reads Management/public settings before continuing. It then deploys the fail-closed rollback artifact. Only after those safety restorations does it fetch fresh exact-account Workers headroom before attempting rollback smoke. Missing capacity evidence skips the smoke, records both capacity and unproven-smoke failures, and still attempts catalogue recovery plus user/data, Worker-secret, and widget cleanup. A target-bound Cloudflare API 404 proves an absent Worker has an empty secret inventory; other account/name/status combinations fail closed. If the exact 18 migrations exist but the catalogue seed is missing or partial, cleanup idempotently reruns the canonical atomic repository seed and attests `196/48/335` before continuing. It deletes only exact ledger-owned users, proves cascades and final zero run-owned rows, deletes/attests both Worker secrets, discovers/deletes the widget by saved site key or unique name+domain fallback, and re-attests Auth/public settings, the four exact migration-created private bucket definitions with zero objects, catalogue counts, and zero run data. Capacity/smoke or any other cleanup failure retains recovery state, ledger, generated config, and failure artifacts for idempotent retry; they are deleted only after every proof succeeds.

The repair candidate has one deliberately narrow recovery-adoption capability. It may clean the failed `a9d55c0ef1138dfb33c09328abdfa59bc3981cd0` run only when the recovery hash is `65a7312fe5a7829d7cd5850bc71bc3d29e57f40a991ba070c6523044b00518e3`, the generated-config hash is `afe2b4621b71c8a4a5bef19245084dfc3975ab6b0ee0f0d5af32ddf074e9b21f`, and exact run/project/account/Worker identity all match the tracked manifest. After that immutable predecessor is accepted, every current recovery write is HMAC-authenticated and binds the exact candidate, provider identities, run/widget intent, saved site key, timestamps, seal state, and live/retained ledger and generated-config hashes. No other predecessor or unsigned current recovery is accepted. `baseline-establishment-receipt.json` separately preserves either the exact legacy adoption or a successful pristine-to-migrated establishment; `cleanup-receipt.json` records each authenticated current-run cleanup, including pristine cleanup, without overwriting baseline provenance. Both MAC the exact observed final mode/counts/fingerprints. A later migrated-baseline execution requires the preserved baseline-establishment receipt and skips link, dry-run, push, migration replay, and catalogue reseeding.

```powershell
& .\scripts\issue22-hosted\run-operator.ps1 -Mode hosted-cleanup -CandidateSha <same-reviewed-SHA>
```

Never mutate the forbidden project, use a public Turnstile test pair, normalize migration bytes, invoke raw/reset/repair database commands, confirm via admin/service role, delete an unledgered identity, or claim hosted PASS before successful cleanup.

## Cost boundary

The failed run produced provider error `100328`: explicit `limits.cpu_ms` is unsupported on Workers Free. Both Worker configs therefore omit explicit CPU limits. `default_usage_model=standard` is treated only as an account setting, **not** proof of the paid Standard plan. Every pre-execution gate queries both the current UTC-day and current-month `workersInvocationsAdaptive` aggregates. It requires Free daily request headroom under the 100,000/day allowance and, conservatively, Standard included monthly headroom under 10,000,000 requests and 30,000,000 CPU ms without creating or upgrading paid resources. Workers Free hard-enforces 10 ms CPU and 50 subrequests per dynamic invocation; static asset requests are free. Treating all 587 bounded requests as dynamic caps the Free path at 5,870 CPU ms. Because a paid Worker with no explicit CPU limit defaults to 30,000 ms/request, the same path also reserves 17,610,000 CPU ms of Standard included headroom. Recovery cleanup restores disabled Auth and rollback before repeating capacity lookup; inadequate evidence prevents smoke requests but never blocks independent cleanup. The operator uses one temporary Free Turnstile widget and declares no paid binding. Any provider drift requiring paid capacity is a hard stop.
