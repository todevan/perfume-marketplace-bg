# Gate 3 — Public Form Bounds and Beta Verification

**Execution date:** 2026-08-09  
**Document role:** Historical Gate 3 execution record and verification evidence.  
**Historical gate decision:** `BLOCKED`.

> This file records what was actually implemented, verified, and blocked during the 2026-08-09 Gate 3 execution.
>
> Its `BLOCKED` decision, SHAs, provider drift, migration inventory, account availability, and hosted preflight results describe that checkpoint. They are not automatically the current Gate 3/A-series/project state.
>
> Later staging-reconciliation and A-series evidence may supersede the operational blocker described here without changing the truth of this historical record.

## Authority and reuse discipline

This document is evidence, not a second execution workflow or current executable queue.

For current work:

1. follow `AGENTS.md`;
2. use authoritative current project/product/security/operational docs;
3. read current `docs/PROJECT-STATUS.md` and active gate/A-series evidence;
4. use the canonical GitHub Issue and exact named-gate scope;
5. use Superpowers as the process authority;
6. use Matt Pocock deep-engineering skills when useful;
7. use ECC/platform specialists when useful;
8. use repository-defined verification for completion.

Do not reopen or rerun Gate 3 work merely because this file contains a historical
unchecked item.

Historical `PASS` evidence here does not automatically prove a later candidate,
and historical `BLOCKED` evidence does not prove that the same blocker still
exists.

Named-gate scope remains strict. For example, `A9 only` does not authorize
A8/A10, provider, migration, deployment, or production mutations.

---

## Objective

Bound public auth request bodies at the application level and prove the corrected
tree is ready for hosted Phase 2 verification.

## Primary files

- `src/lib/server/http/request-body.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- other anonymous auth actions discovered by inventory

## Scope rule

Start with anonymous/public auth endpoints.

Record remaining authenticated raw `request.formData()` calls for follow-up
unless changing them is required by the centralized helper or is trivially safe
within the explicitly authorized gate scope.

Gate 3 does not authorize a repository-wide form-parsing rewrite.

## Small text-form profile

The planning target was approximately:

- max total bytes: 64 KiB;
- files: none;
- parts: ~30.

The implementation adapted that profile to the repository's bounded parser.

The actual request stream must be bounded; `Content-Length` alone is not
sufficient.

## Normal-user authentication compatibility

Gate 3 preserves the current product boundary:

- public email/password registration;
- email confirmation;
- no invitation requirement for normal users;
- no phone/SMS OTP requirement for normal-user activation, first listing,
  offers, or ordinary marketplace actions;
- staff/admin MFA/AAL2 remains mandatory.

Beta access, membership, onboarding, or historical invite/bootstrap data must
not be interpreted as authority to restore invite-only or phone-gated normal-user
registration.

---

## Gate 3 implementation checklist at this checkpoint

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
- [ ] Execute the required hosted Phase 2 checks — not completed at this checkpoint.

## Hosted Phase 2 checklist at this checkpoint

The following rows preserve the state recorded during this Gate 3 execution.
They must not be used as a current hosted checklist without reconciling later
Gate 3/A-series evidence.

- [ ] signup → confirmation → onboarding → authenticated destination — `NOT RUN`
- [ ] active user → `/login` → intended destination — `NOT RUN`
- [ ] password recovery → update → intended destination — `NOT RUN`
- [ ] staff AAL1 behavior — `NOT RUN`
- [ ] staff AAL2 behavior and `/admin` — `NOT RUN`
- [ ] evidence isolation — `NOT RUN`; load-bearing audit High remained open
- [ ] relevant multi-session races — `NOT RUN`
- [ ] cleanup — `NOT RUN`
- [ ] restore rehearsal — `NOT RUN`
- [ ] provider/runtime configuration, including Turnstile action validation — `NOT RUN`

## Acceptance criteria at this checkpoint

- [x] Public auth request bodies are bounded.
- [x] Oversized requests fail before expensive/provider operations.
- [x] Unit/server suite green where runnable.
- [x] Svelte check green.
- [x] Build green.
- [x] DB lint/tests green where runnable.
- [x] E2E green where runnable.
- [x] Any unrun command/check is explicitly marked `NOT RUN` with reason.
- [ ] No audited High issue remains open — `BLOCKED` on hostile hosted report-evidence verification.

---

# Execution Record

**Status at this checkpoint:** `BLOCKED`

**Execution date:** 2026-08-09

**Branch:** `main`

**Baseline HEAD:** `fb3e644615c6bbe4895142d6fc4fabbce00e853f`

This status is the result of the recorded 2026-08-09 execution. It must not be
presented as the current project status without checking later evidence.

## Scope reconciliation and inventory

- Gate 2 recorded COMPLETE/PASS.
- All Gate 0–2 changes and the existing dirty tree were treated as protected owner work.
- The initial source inventory found 34 raw `request.formData()` calls.
- Exactly three were public/anonymous auth actions owned by Gate 3:
  - login;
  - registration;
  - reset-password.
- The final public-auth raw count was zero.
- The final centralized bounded-call count was three.
- The remaining 31 raw calls were behind authenticated, beta, or staff route
  policy.
- Those 31 calls were recorded for follow-up and intentionally not changed
  because Gate 3 scoped this task to public/anonymous auth actions.
- Existing file-bearing listing-upload and report actions already used the
  protected bounded parser and were reused without Gate 3 changes.
- Local Supabase ports remained `45320`–`45326`.
- No Supabase, Wrangler, migration, RLS, provider, service-role, secret, or
  hosted configuration was changed by the initial local Gate 3 implementation.
- No worktree, commit, stage, push, pull request, issue, deployment, reset,
  stash, clean, or remote mutation was performed during that local execution.

The final bullet above records what happened during this historical execution.
It is not a current rule prohibiting normal autonomous Git actions.

## Files changed by Gate 3

- `package.json`
- `pnpm-lock.yaml`
- `src/lib/server/http/request-body.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- `tests/server/request-body.test.ts`
- `tests/server/anonymous-auth-action-body-limits.test.ts`
- `docs/superpowers/plans/gate-3-beta-verification.md`

## Existing protected work reused

- Existing streaming bounded parser.
- Safe typed errors.
- Existing upload/report adoption.
- Ten focused helper tests.
- Gate 1 auth lifecycle behavior.
- Gate 2 action-bound registration/login Turnstile behavior.
- Existing validation.
- Safe redirects.
- Demo behavior.
- Confirmation URL handling.
- Membership claim behavior.
- Reset anti-enumeration response.
- Reset callback behavior.

---

## TDD and systematic-debugging evidence

### 1. Helper RED

Command:

```bash
pnpm vitest run tests/server/request-body.test.ts
```

Result:

- 1 failing;
- 10 passing.

A valid standard URL-encoded form failed because the old validator rejected
`maxFiles: 0`.

This was the expected missing-profile behavior failure.

### 2. Helper GREEN

The centralized profile and narrow zero-file support passed:

```text
17/17 focused helper tests
```

The exact resulting profile was:

```text
max total bytes: 64 KiB
maxFileBytes: 1
maxFiles: 0
maxParts: 30
default header bound: 8 KiB
```

### 3. Route RED

Command:

```bash
pnpm exec vitest run tests/server/anonymous-auth-action-body-limits.test.ts
```

Result:

- 1 passing;
- 6 failing.

Under raw parsing:

- each oversized real action made exactly one Turnstile request;
- each reached the corresponding provider path;
- login returned 400 instead of 413;
- registration reached its success/provider path;
- reset-password reached its success/provider path;
- malformed forms threw from raw `request.formData()`.

This demonstrated that the resource boundary was missing at the correct route
layer.

### 4. Route GREEN

After the minimum parser adoption, the focused parser/route/Gate 2 run passed:

```text
34/34 tests
```

Oversized and malformed bodies now stop before:

- field/business validation;
- demo handling;
- Turnstile;
- Supabase/provider work.

### 5. Final-command timeout investigation

The first final `pnpm test` invocation was killed by a five-second harness timeout
before producing results.

Systematic debugging identified the command timeout rather than an application
test failure.

The unchanged command was rerun with a normal timeout and passed completely.

The initial harness timeout was therefore not recorded as a product-test failure.

---

# Acceptance Evidence

| Required condition | Verification command or evidence source | Actual result | Decision |
|---|---|---|---|
| Public auth actions use bounded body parsing | Final `rg` inventory and route source | 0 public-auth raw parsers; 3 centralized standard bounded calls | PASS |
| Actual stream is bounded; `Content-Length` alone is insufficient | `tests/server/request-body.test.ts` | Missing and understated lengths still reject actual streams over 64 KiB | PASS |
| Standard profile is centralized, small, and text-only | Helper source and 17/17 focused helper tests | 64 KiB, 1-byte file setting, 0 files, 30 parts; valid URL-encoded/multipart text succeeds; files/excess parts reject | PASS |
| Oversized login rejects before expensive/provider work | Real login action test | 413; zero Turnstile requests; zero `signInWithPassword` calls | PASS |
| Oversized registration rejects before expensive/provider work | Real registration action test | 413; zero Turnstile requests; zero `signUp` calls | PASS |
| Oversized reset-password rejects before expensive/provider work | Real reset action test | 413; zero Turnstile requests; zero `resetPasswordForEmail` calls | PASS |
| Malformed public auth forms reject predictably | Real route table tests | Generic 400 for all three; zero external calls | PASS |
| Existing auth/Turnstile/redirect/validation behavior remains intact | Focused Gate 1/2 regressions, full suite, independent review | Valid requests retain established behavior and exact action ordering | PASS |
| All available local verification is green | Fresh canonical command table below | Every required local command exited 0 | PASS |
| Unavailable hosted verification is explicit | Hosted checklist and E2E skip evidence | All hosted checks recorded NOT RUN; no hosted success claimed | PASS |
| Hosted Phase 2 checklist is ready | Checklist plus guarded real-beta harness | Preconditions and required scenarios identified for separately authorized hosted execution | PASS |
| No High-severity audit finding remains open | Audit, then-current project status, independent review | Hostile hosted report-evidence ownership/cleanup acceptance remained unrun | BLOCKED |

---

# Fresh Final Local Verification — 2026-08-09 Candidate

These results are fresh for the candidate evaluated by this Gate 3 execution.
They are historical evidence for that candidate, not automatic evidence for a
later SHA.

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

---

# Independent Review

The following review results apply to this historical Gate 3 candidate.

- Helper task review:
  - specification PASS;
  - task quality Approved;
  - no Critical, Important, or Minor findings.
- Public-auth route task review:
  - specification PASS;
  - task quality Approved;
  - no Critical, Important, or Minor findings.
- Final whole-gate code/security review:
  - local implementation approved;
  - no Critical or Minor code findings.

The final reviewer independently confirmed:

- actual-stream enforcement;
- exact bounded profile;
- safe typed errors;
- all three public-auth action orderings;
- effective real-action tests;
- preserved Gate 1 behavior;
- preserved Gate 2 behavior;
- exact 3-to-31 scope split;
- no secret/service-role/privacy regression.

One Important gate-level finding remained at this checkpoint:

> local verification could not close the audited hosted report-evidence ownership High.

---

# Hosted Blocker Recorded at this Checkpoint

The initial local implementation was complete and green, but the remaining
load-bearing finding required hosted staging evidence.

The required categories were:

1. authorized staging origin and exact staging target;
2. synthetic ordinary-user sessions;
3. moderator AAL1/AAL2 sessions;
4. testing Turnstile configuration;
5. current hosted migrations/runtime;
6. lifecycle verification;
7. hostile report-evidence verification;
8. sanitized retained evidence;
9. scoped cleanup.

The initial local Gate 3 run did not perform hosted actions.

The owner subsequently authorized a narrow hosted evidence-verification step.
The read-only hosted preflight below failed closed before any state-changing
scenario was started.

That authorization and this failed preflight are historical events. They are not
blanket authority for a later hosted mutation.

---

# Hosted Evidence Preflight — 2026-08-09

## Verified target identity at that checkpoint

The preflight established the following authorized staging boundary:

- application origin:

```text
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev
```

- Supabase project:

```text
perfume-marketplace-bg-staging
```

- project ref:

```text
nuhkpqjjyuygiemrxbdp
```

- organization:

```text
khazvscqabwvslnphbqp
```

- region:

```text
eu-central-1
```

- PostgreSQL:

```text
17
```

The former Stockholm ref remained explicitly forbidden:

```text
zllqwlekadiuyejgbuxc
```

The local Supabase link pointed to the Frankfurt ref and Wrangler was
authenticated to the expected Cloudflare account.

These target identifiers remain durable safety boundaries where confirmed by
current operational docs, but the surrounding provider/runtime inventory below
is a 2026-08-09 snapshot.

---

## Fresh read-only evidence and stop conditions at that checkpoint

| Evidence source | Actual result | Decision |
|---|---|---|
| `pnpm db:staging:verify-target` with the public values read in memory from `wrangler.jsonc` | Project metadata passed, but the guard rejected the configured staging publishable key because it was not the current key in the project's API-key inventory. No mutation was attempted. | BLOCKED |
| Sanitized Supabase API-key inventory comparison | The project had one current 46-character default publishable key. It did not equal the 46-character configured key. No key value was printed. | BLOCKED |
| Read-only `GET /auth/v1/settings` with each publishable key | Configured key returned HTTP 401; then-current inventory key returned HTTP 200. Public signup was enabled and email auto-confirm was disabled. | Confirmed configuration drift |
| Read-only staging Worker probes | `/login` and `/robots.txt` returned HTTP 200 with request IDs and deployed Git SHA `ada151d1fe68a7d12402084818df2f9df15624cd`. | Target reachable |
| Deployed-SHA ancestry and source inventory | Deployed SHA was an ancestor 11 commits behind protected HEAD `fb3e644615c6bbe4895142d6fc4fabbce00e853f`. Its source contained migrations 001–010 and none of 012–014. The Gate 0–3 implementation under evaluation was protected uncommitted work and was not the deployed artifact. | BLOCKED |
| Staging runtime configuration | `IMAGE_PROCESSOR_MODE` was `disabled`; no staging Turnstile variables were committed. The evidence route could not perform image-evidence creation on that configuration. | BLOCKED |
| Existing hosted Playwright harness | `E2E_REAL_RUN` and the required account/base-URL/testing-Turnstile inputs were unset. The suite intentionally skipped unless enabled and covered the marketplace lifecycle plus moderator AAL2, not the full report-evidence matrix. | BLOCKED |

The key mismatch and stale hosted runtime demonstrated:

> **Hosted schema/runtime state differs materially from local assumptions.**

The hosted task therefore stopped.

It did **not**:

- substitute the key;
- bypass target verification;
- deploy;
- migrate;
- create accounts;
- elevate roles;
- enroll MFA;
- change providers;
- execute hostile hosted evidence tests.

That fail-closed stop is part of the Gate 3 evidence.

---

# Required Synthetic Actors Identified by the Preflight

The hosted evidence design required:

- one active ordinary reporter account;
- one different active ordinary target/cross-user account;
- one active assigned moderator with enrolled TOTP;
- one different active unassigned moderator with separate enrolled TOTP;
- an AAL2 administrator only if the approved workflow could not assign the case
  through the moderator claim path.

No actor credentials were available in the execution environment.

The preflight did not infer account existence from an older zero-user checkpoint.

It did not:

- create a public signup;
- create a privileged fixture;
- elevate a role;
- enroll TOTP;
- reuse an unknown account.

The later provisioning of actors belongs to the subsequent staging-reconciliation
/A-series evidence, not to this Gate 3 preflight record.

---

# Hosted Report-Evidence Scenario Matrix at the 2026-08-09 Stop Point

The following matrix records **what had not yet executed when this Gate 3
preflight stopped**.

Later evidence may close individual rows. Do not overwrite these historical
`NOT EXECUTED` values merely to make this checkpoint look current.

| Scenario | Actor / precondition | Action and required proof | Expected result | Actual result at this checkpoint | Status | Cleanup |
|---|---|---|---|---|---|---|
| Cross-user evidence denial | Active reporter and different active ordinary user; attached evidence on hardened runtime | Attempt exact Storage object read as second user and retain actual HTTP/Storage denial | Reporter can read; other user receives authorization denial and zero bytes | NOT EXECUTED — stale runtime, key drift, accounts unavailable | BLOCKED | None; no data created |
| Report evidence creation | Active reporter, valid target, testing Turnstile, Cloudflare Images sanitizer, migration 014 | Submit synthetic valid image and observe report/private object/ledger without leaking object path | Success; one private sanitized WebP allocation/object belongs to reporter | NOT EXECUTED — image processor disabled and hardened runtime absent | BLOCKED | None |
| Evidence finalization | Successful allocation and Storage upload on migration 014 | Verify server-only finalization metadata and attached state via sanitized trusted receipt | Object exists before finalization; hash, size and dimensions recorded; attachment succeeds | NOT EXECUTED — migration/runtime and secure operator receipt unavailable | BLOCKED | None |
| One-time attachment | Finalized reporter-owned evidence and one committed report | Attempt reuse through authenticated DB boundary | First attachment succeeds atomically; second report cannot reuse evidence | NOT EXECUTED — no finalized hosted evidence | BLOCKED | None |
| Assigned-moderator access | Investigating report assigned to AAL2 moderator | Read exact object through authenticated Storage boundary | Assigned AAL2 moderator receives object; access auditable | NOT EXECUTED — moderator/MFA actors unavailable | BLOCKED | None |
| Unassigned moderator rejection | Different active AAL2 moderator | Attempt same exact Storage read | Unassigned moderator receives authorization denial and zero bytes | NOT EXECUTED — second moderator actor unavailable | BLOCKED | None |
| Required moderator AAL2 | Assigned moderator with password-only AAL1, then verified TOTP AAL2 | Attempt exact read at each assurance level | AAL1 denied/challenged; same assigned actor succeeds only after AAL2 | NOT EXECUTED — assigned MFA actor unavailable | BLOCKED | None |
| Evidence cleanup/lifecycle | Synthetic unattached/rejected allocation, cleanup function, scheduler and queue RPCs | Cause bounded rejection/expiry and verify durable cleanup/object deletion | Rejected/expired evidence enters durable queue and exact object is deleted once without path leak | NOT EXECUTED — migration 014 and cleanup runtime not verified | BLOCKED | None |
| Malformed upload rejection | Active reporter and testing Turnstile | Submit image-labelled malformed payload and verify zero downstream state | Safe 400; no report/object/finalized allocation | NOT EXECUTED — current hardened route/runtime and actor unavailable | BLOCKED | None |
| Oversized/hostile/chunked upload | Active reporter, testing Turnstile, streaming client | Send over-limit, missing/understated-length and malformed multipart bodies | 413 for actual-stream limits, 400 for malformed multipart, zero allocation/upload/report effects | NOT EXECUTED — Gate 3 Worker under evaluation was not deployed and actor/config prerequisites were absent | BLOCKED | None |

---

# Follow-up Scope Identified by This Preflight

At the end of this 2026-08-09 checkpoint, the smallest safe follow-up identified
by the evidence was:

1. reconcile the stale staging public-key configuration through target-locked
   verification;
2. create an immutable attributable staging release of the protected Gate 0–3
   work;
3. reconcile the exact hosted forward-migration state;
4. configure only the staging providers required for the report-evidence test;
5. deploy/verify the cleanup function and scheduler where required;
6. provision only the required synthetic actors and moderator MFA state;
7. run the narrow hosted lifecycle/report-evidence matrix;
8. prove scoped cleanup.

This list is **historical handoff context**, not current mutation authority.

The detailed implementation/safety sequence was subsequently separated into:

```text
docs/superpowers/plans/2026-08-09-gate-3-staging-reconciliation.md
```

Current work must use the later/current A-series state rather than rerunning this
handoff from step 1.

No hosted data or configuration changed during the preflight recorded here.

No:

- user;
- role;
- report;
- evidence object;
- allocation;
- cleanup item;
- provider setting;

was created or changed.

Cleanup required for this particular preflight was therefore:

```text
none
```

---

# Historical Gate Decision

**Decision on 2026-08-09:** `BLOCKED`

**Reason:**

The local Gate 3 implementation was technically complete, freshly locally
verified, and independently approved.

The gate could not record PASS at that checkpoint because the load-bearing
hosted report-evidence ownership/cleanup acceptance remained unexecuted and the
read-only staging preflight proved material hosted configuration/runtime drift.

The preflight failed closed before state-changing hosted work.

No later gate or deferred hardening work was started by this Gate 3 execution.

This decision must remain intact as historical evidence even if later staging
reconciliation or A-series work resolves the blocker.

---

# Canonical Verification Commands Used by This Gate

```bash
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

For reuse on a later candidate:

- run the current repository-defined equivalents;
- record `PASS`, `FAIL`, or `NOT RUN` independently;
- do not inherit these 2026-08-09 results;
- do not claim hosted verification from local E2E skips.

---

# Archival and Reuse Rule

Do not rewrite this file's:

- 2026-08-09 status;
- baseline SHA;
- local test counts;
- deployed SHA observed by the preflight;
- provider drift observed by the preflight;
- `NOT EXECUTED` hosted scenario rows;

merely because later work has progressed.

Instead, later progress belongs in:

- the subsequent staging-reconciliation plan/evidence;
- current A-series evidence;
- current GitHub Issues/PRs/CI;
- `docs/PROJECT-STATUS.md` when current state materially changes.

If current work needs to understand why staging reconciliation existed, this
file is the historical causal record:

```text
local Gate 3 implementation = green
hosted evidence = still required
read-only staging preflight = materially drifted
safe response = stop without mutation
next boundary = staging reconciliation
```