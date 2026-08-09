# Gate 3 — Public Form Bounds and Beta Verification

## Objective
Bound public auth request bodies at the application level and prove the corrected tree is ready for hosted Phase 2 verification.

## Primary files
- `src/lib/server/http/request-body.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- other anonymous auth actions discovered by inventory

## Scope rule
Start with anonymous/public auth endpoints. Record the remaining authenticated raw `request.formData()` calls for follow-up unless changing them is required by the centralized helper or is trivially safe within this gate.

## Proposed small text-form profile
Target approximately:
- max total bytes: 64 KiB
- files: none
- parts: ~30

Adapt the exact shape to the repository's existing bounded parser. The actual stream must be bounded; `Content-Length` alone is not sufficient.

## TDD order
- [x] Inventory current raw `request.formData()` calls.
- [x] Classify public vs authenticated/file-bearing calls.
- [x] Add oversized registration form test.
- [x] Add oversized login form test.
- [x] Add oversized reset-password form test.
- [x] Confirm failures against raw parsing.
- [x] Add or expose centralized standard text-form limits.
- [x] Move public auth actions to bounded parsing.
- [x] Confirm rejection occurs before Turnstile/provider/auth operations where applicable.
- [x] Run focused tests.
- [x] Run full local verification.
- [ ] Execute hosted Phase 2 checks in an owner-authorized hosted environment. Checklist prepared; checks NOT RUN.

## Hosted Phase 2 checks
- [ ] signup → confirmation → onboarding → authenticated destination — NOT RUN
- [ ] active user → `/login` → intended destination — NOT RUN
- [ ] password recovery → update → intended destination — NOT RUN
- [ ] staff AAL1 behavior — NOT RUN
- [ ] staff AAL2 behavior and `/admin` — NOT RUN
- [ ] evidence isolation — NOT RUN; load-bearing audit High remains open
- [ ] relevant multi-session races — NOT RUN
- [ ] cleanup — NOT RUN
- [ ] restore rehearsal — NOT RUN
- [ ] provider/runtime configuration, including Turnstile action validation — NOT RUN

## Acceptance criteria
- [x] Public auth request bodies are bounded.
- [x] Oversized requests fail before expensive/provider operations.
- [x] Unit/server suite green where runnable.
- [x] Svelte check green.
- [x] Build green.
- [x] DB lint/tests green where runnable.
- [x] E2E green where runnable.
- [x] Any unrun command/check is explicitly marked NOT RUN with reason.
- [ ] No audited High issue remains open — BLOCKED on hostile hosted report-evidence verification.

## Execution Record
**Status:** BLOCKED

**Execution date:** 2026-08-09

**Branch:** `main`

**Baseline HEAD:** `fb3e644615c6bbe4895142d6fc4fabbce00e853f`

### Scope reconciliation and inventory

- Gate 2 records COMPLETE/PASS. All Gate 0–2 changes and the existing dirty tree were treated as protected owner work.
- The initial source inventory found 34 raw `request.formData()` calls. Exactly three were public/anonymous auth actions owned by Gate 3: login, registration, and reset-password.
- The final public-auth raw count is zero and the final centralized bounded-call count is three.
- The remaining 31 raw calls are behind authenticated, beta, or staff route policy. They are recorded for follow-up and were not changed because the Gate 3 plan explicitly limits this task to public/anonymous auth actions.
- Existing file-bearing listing-upload and report actions already used the protected bounded parser and were reused without Gate 3 changes.
- Local Supabase ports remain `45320`–`45326`. No Supabase, Wrangler, migration, RLS, provider, service-role, secret, or hosted configuration was changed.
- No worktree, commit, stage, push, pull request, issue, deployment, reset, stash, clean, or remote mutation was performed.

### Files changed by Gate 3

- `package.json`
- `pnpm-lock.yaml`
- `src/lib/server/http/request-body.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- `tests/server/request-body.test.ts`
- `tests/server/anonymous-auth-action-body-limits.test.ts`
- `docs/superpowers/plans/gate-3-beta-verification.md` (this execution record)

### Existing protected work reused

- The existing streaming bounded parser, safe typed errors, upload/report adoption, and ten focused helper tests.
- Gate 1 auth lifecycle behavior and Gate 2 action-bound registration/login Turnstile behavior.
- Existing validation, safe redirects, demo behavior, confirmation URL, membership claim, reset anti-enumeration response, and reset callback.

### TDD and systematic-debugging evidence

1. Helper RED: `pnpm vitest run tests/server/request-body.test.ts` produced 1 failing and 10 passing tests. A valid standard URL-encoded form failed because the old validator rejected `maxFiles: 0`. This was the expected missing-profile behavior failure.
2. Helper GREEN: the centralized profile and narrow zero-file support passed 17/17 focused helper tests. The exact profile is 64 KiB total, `maxFileBytes: 1`, zero files, and 30 parts; the existing 8 KiB default header bound remains.
3. Route RED: `pnpm exec vitest run tests/server/anonymous-auth-action-body-limits.test.ts` produced 1 passing and 6 failing tests. Under raw parsing, each oversized real action made exactly one Turnstile request and exactly one corresponding provider call. Login returned 400 instead of 413; registration/reset reached their success paths. Malformed forms threw from raw `request.formData()`.
4. Route GREEN: after the minimum parser adoption, the focused parser/route/Gate 2 run passed 34/34 tests. Oversized and malformed bodies now stop before validation, demo handling, Turnstile, or provider work.
5. The first final `pnpm test` invocation was killed by a five-second harness timeout before producing results. Systematic debugging identified only the command timeout; the unchanged command was rerun with a normal timeout and passed completely. The timeout is not recorded as a product-test failure.

### Acceptance evidence

| Required condition | Verification command or evidence source | Actual result | Decision |
|---|---|---|---|
| Public auth actions use bounded body parsing | Final `rg` inventory and current route source | 0 public-auth raw parsers; 3 centralized standard bounded calls | PASS |
| Actual stream is bounded; `Content-Length` alone is insufficient | `tests/server/request-body.test.ts` | Missing and understated lengths still reject actual streams over 64 KiB | PASS |
| Standard profile is centralized, small, and text-only | Helper source and 17/17 focused helper tests | 64 KiB, 1-byte file setting, 0 files, 30 parts; valid URL-encoded/multipart text succeeds; files/excess parts reject | PASS |
| Oversized login rejects before expensive/provider work | Real login action test | 413; zero Turnstile requests; zero `signInWithPassword` calls | PASS |
| Oversized registration rejects before expensive/provider work | Real registration action test | 413; zero Turnstile requests; zero `signUp` calls | PASS |
| Oversized reset-password rejects before expensive/provider work | Real reset action test | 413; zero Turnstile requests; zero `resetPasswordForEmail` calls | PASS |
| Malformed public auth forms reject predictably | Real route table tests | Generic 400 for all three; zero external calls | PASS |
| Existing auth/Turnstile/redirect/validation behavior remains intact | Focused Gate 1/2 regressions, full suite, independent review | Valid requests retain established behavior and exact action ordering | PASS |
| All available local verification is green | Fresh canonical command table below | Every required local command exited 0 | PASS |
| Unavailable hosted verification is explicit | Hosted checklist and E2E skip evidence | All hosted checks recorded NOT RUN; no hosted success claimed | PASS |
| Hosted Phase 2 checklist is ready | Checklist above plus existing guarded real-beta harness | Preconditions and required scenarios are identified for owner-authorized execution | PASS |
| No High-severity audit finding remains open | Audit, current project status, independent final review | Hostile hosted report-evidence ownership/cleanup acceptance remains unrun | BLOCKED |

### Fresh final verification

| Command | Actual result | Decision |
|---|---|---|
| `pnpm exec vitest run tests/server/anonymous-auth-action-body-limits.test.ts tests/server/login-backend-attestation.test.ts tests/server/request-body.test.ts --reporter=verbose --maxWorkers=1` | 3 files passed; 34/34 tests passed | PASS |
| `pnpm test` | Catalog passed; 40/40 files and 340/340 tests passed; Svelte check 0 errors/0 warnings; production Cloudflare build passed | PASS |
| `pnpm check` | Svelte check 0 errors and 0 warnings | PASS |
| `pnpm build` | Production Cloudflare build passed | PASS |
| `pnpm db:lint` | No schema errors | PASS |
| `pnpm db:test` | 6 pgTAP files; 185/185 tests passed | PASS |
| `pnpm test:e2e` | 13 passed; 5 skipped; exit 0 | PASS with skips recorded |
| `git diff --check` | Exit 0; only existing line-ending warnings | PASS |

### Independent review

- Helper task review: specification PASS and task quality Approved; no Critical, Important, or Minor findings.
- Public-auth route task review: specification PASS and task quality Approved; no Critical, Important, or Minor findings.
- Final whole-gate code/security review: local implementation approved; no Critical or Minor code findings.
- The final reviewer independently confirmed actual-stream enforcement, exact profile, safe typed errors, all three action orderings, effective real-action tests, preserved Gate 1/2 behavior, exact 3-to-31 scope split, and no secret/service-role/privacy regression.
- One Important gate finding remains: local verification cannot close the audited hosted report-evidence ownership High.

### Hosted blocker and smallest closure scope

The following owner-controlled staging evidence is required before Gate 3 can be re-evaluated:

1. Use the authorized staging origin, synthetic seller/buyer accounts, moderator AAL1/AAL2 coverage, testing Turnstile configuration, and current hosted migrations/runtime.
2. Execute the lifecycle checks listed above without exposing credentials in logs or artifacts.
3. Execute hostile report-evidence acceptance for cross-user denial, finalization, one-time attachment, assigned-moderator AAL2 reads, AAL1/wrong-assignee denial, abandoned-object cleanup, and malformed/chunked uploads.
4. Retain sanitized evidence of the actual hosted results and update this record only after every load-bearing result is green.

The initial local Gate 3 run did not perform hosted actions. The owner then
authorized the narrow hosted evidence-verification step. The read-only hosted
preflight below failed closed before any state-changing scenario was started.

### Hosted evidence preflight — 2026-08-09

#### Verified target identity

- The only authorized application origin is
  `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev`.
- The only authorized Supabase target is project
  `perfume-marketplace-bg-staging`, ref `nuhkpqjjyuygiemrxbdp`, organization
  `khazvscqabwvslnphbqp`, Frankfurt `eu-central-1`, PostgreSQL 17. The former
  Stockholm ref remains explicitly forbidden.
- The local Supabase link points to the Frankfurt ref and Wrangler is
  authenticated to the expected Cloudflare account.

#### Fresh read-only evidence and stop conditions

| Evidence source | Actual result | Decision |
|---|---|---|
| `pnpm db:staging:verify-target` with the public values read in memory from `wrangler.jsonc` | Project metadata passed, but the guard rejected the configured staging publishable key because it is not the current key in the project's API-key inventory. No mutation was attempted. | BLOCKED |
| Sanitized Supabase API-key inventory comparison | The project has one current 46-character default publishable key. It does not equal the 46-character configured key. No key value was printed. | BLOCKED |
| Read-only `GET /auth/v1/settings` with each publishable key | Configured key returned HTTP 401; current inventory key returned HTTP 200. Public signup is enabled and email auto-confirm is disabled. | Confirms configuration drift |
| Read-only staging Worker probes | `/login` and `/robots.txt` returned HTTP 200 with request IDs and deployed Git SHA `ada151d1fe68a7d12402084818df2f9df15624cd`. | Target reachable |
| Deployed-SHA ancestry and source inventory | The deployed SHA is an ancestor 11 commits behind protected HEAD `fb3e644615c6bbe4895142d6fc4fabbce00e853f`. Its source contains migrations 001–010 and none of 012–014. The current Gate 0–3 implementation is protected uncommitted work and is not the deployed artifact. | BLOCKED |
| Current staging runtime configuration | `IMAGE_PROCESSOR_MODE` is `disabled`; no staging Turnstile variables are committed. The evidence route therefore cannot perform image evidence creation on this configuration. | BLOCKED |
| Existing hosted Playwright harness | `E2E_REAL_RUN` and every required account/base-URL/testing-Turnstile variable are unset. The suite intentionally skips unless enabled and covers the marketplace lifecycle plus moderator AAL2, not the required report-evidence matrix. | BLOCKED |

The key mismatch and stale hosted runtime trigger master-plan escalation rule 6:
**Hosted schema/runtime state differs materially from local assumptions.** The
active hosted task therefore stopped without substituting keys, bypassing the
guard, deploying, migrating, creating users, elevating roles, or changing a
provider.

#### Required synthetic actors

- one active ordinary reporter account;
- one different active ordinary target/cross-user account;
- one active assigned moderator with an already-enrolled TOTP factor;
- one different active unassigned moderator with an already-enrolled TOTP
  factor;
- an AAL2 administrator only if the hosted workflow cannot assign the case
  through the approved moderator claim path.

No account credentials were available in the execution environment. Account
existence was not inferred from the older zero-user checkpoint, and no public
signup or privileged provisioning attempt was made.

#### Hosted report-evidence scenario matrix

| Scenario | Actor / precondition | Action and required proof | Expected result | Actual result | Status | Cleanup |
|---|---|---|---|---|---|---|
| Cross-user evidence denial | Active reporter and a different active ordinary user; attached evidence on the current hardened runtime | Attempt the exact Storage object read as the second user and retain the HTTP/Storage denial, not only missing UI | Reporter can read; other user receives an authorization denial and no object bytes | NOT EXECUTED — stale runtime, key drift, and accounts unavailable | BLOCKED | None; no data created |
| Report evidence creation | Active reporter, valid target, testing Turnstile, Cloudflare Images sanitizer, migration 014 | Submit a synthetic valid image and observe route result, report ID, private object, and ledger state without logging the object path | HTTP/action success; one private sanitized WebP allocation/object is associated with the reporter | NOT EXECUTED — image processor disabled and hardened runtime absent | BLOCKED | None |
| Evidence finalization | Successful allocation and Storage upload on migration 014 | Verify the server-only finalization metadata and final attached state through a sanitized database/operator receipt | Object must exist before finalization; hash, size and dimensions recorded; final report attachment succeeds | NOT EXECUTED — migration/runtime and secure operator receipt unavailable | BLOCKED | None |
| One-time attachment | Finalized reporter-owned evidence and one committed report | Attempt reuse through the authenticated database boundary and retain the exact denial | First attachment succeeds atomically; a second report cannot reuse the evidence | NOT EXECUTED — no finalized hosted evidence | BLOCKED | None |
| Assigned-moderator access | Investigating report assigned to an AAL2 moderator | Read the exact object through the authenticated Storage boundary | Assigned AAL2 moderator receives the object; access is auditable | NOT EXECUTED — moderator/MFA actors unavailable | BLOCKED | None |
| Unassigned moderator rejection | Different active AAL2 moderator | Attempt the exact same Storage read and retain the denial response | Unassigned moderator receives an authorization denial and no object bytes | NOT EXECUTED — second moderator actor unavailable | BLOCKED | None |
| Required moderator AAL2 | Assigned moderator with password-only AAL1 session, then verified TOTP AAL2 session | Attempt the exact read at each assurance level | AAL1 is denied/challenged; the same assigned actor succeeds only after AAL2 | NOT EXECUTED — assigned MFA actor unavailable | BLOCKED | None |
| Evidence cleanup/lifecycle | Synthetic unattached or deliberately rejected allocation, deployed cleanup function, scheduler secret and current queue RPCs | Cause a bounded rejection/expiry, run or observe the approved cleanup worker, and verify terminal ledger/queue state plus object deletion | Rejected/expired evidence enters the durable queue and the exact object is deleted once without exposing its path | NOT EXECUTED — migration 014 and cleanup deployment/runtime not verified | BLOCKED | None |
| Malformed upload rejection | Active reporter and testing Turnstile | Submit an image-labelled malformed payload and verify response plus absence of report/object/finalized allocation | Safe HTTP/action 400; no evidence becomes attached or readable | NOT EXECUTED — current route/runtime and actor unavailable | BLOCKED | None |
| Oversized/hostile/chunked upload | Active reporter, testing Turnstile and a client capable of streaming multipart without relying on `Content-Length` | Send over-limit, missing/understated-length and malformed multipart bodies; retain HTTP response and zero-downstream-state receipt | 413 for actual-stream limits, 400 for malformed multipart, and no allocation/upload/report side effects | NOT EXECUTED — current Gate 3 Worker is not deployed and actor/config prerequisites are absent | BLOCKED | None |

#### Smallest safe owner setup required

1. Re-verify the current default publishable key in the Frankfurt Dashboard and
   approve reconciliation of the stale `wrangler.jsonc` value. Do not paste a
   server secret, service-role key, database password, access token, or TOTP
   secret into chat.
2. Prepare an immutable staging release containing the protected Gate 0–3 tree
   and authorize its exact deployment. The current uncommitted tree cannot be
   proven by the live deployment SHA.
3. Through the guarded staging operator and a fresh inventory receipt, apply
   forward-only migrations 012–014. Do not use reset or migration repair.
4. Configure the staging Worker with the project-bound public key and existing
   Worker-only Supabase secret, Cloudflare Turnstile always-pass testing keys
   bound to the exact staging hostname, and the reviewed Cloudflare Images
   sanitizer/binding. Keep all credentials in their provider/secure shell.
5. Deploy and verify the current `upload-cleanup` function and its scheduler
   secret/trigger before running the cleanup scenario.
6. Provision or identify only the synthetic actors listed above, activate their
   memberships, enroll the two moderator TOTP factors, and place credentials in
   the trusted local environment using the existing `E2E_REAL_*` convention.
7. Run the existing hosted E2E flows where they apply and a narrow sanitized
   report-evidence harness for the scenarios the existing suite does not cover.

No hosted data or configuration changed during this preflight. No user, role,
report, evidence object, allocation, cleanup item, or provider setting was
created, so cleanup performed is **none required**.

### Gate decision
**BLOCKED**

The local Gate 3 implementation is technically complete, fully locally verified, and independently approved. Gate 3 cannot record PASS while the required hosted report-evidence High remains open. No later gate or post-beta work was started.


## Canonical verification commands

```bash
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

Record PASS / FAIL / NOT RUN for each command used by this gate.
