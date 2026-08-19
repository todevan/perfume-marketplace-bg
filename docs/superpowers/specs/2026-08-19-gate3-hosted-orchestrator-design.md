# Gate 3 Persistent Hosted Orchestrator — Design

Date: 2026-08-19

Status: Written specification for owner review. Architectural design sections 1–5 were approved before this document was written. Implementation is not yet approved.

Repository: `todevan/perfume-marketplace-bg`

Design branch: `codex/gate3-hosted-orchestrator-design`

Primary operator environment: Windows PowerShell 5.1 with Node.js/pnpm tooling.

## 1. Purpose

Gate 3 hosted verification currently requires too much manual coordination across A9 provisioning, A10 scenario execution, A11 cleanup, environment variables, credentials, manifests, hosted state, and abandoned-run recovery.

The new subsystem provides a persistent, simplified, fail-closed hosted orchestrator with the normal operator flow:

```text
pnpm gate3:hosted preflight
pnpm gate3:hosted provision
pnpm gate3:hosted scenario
pnpm gate3:hosted inspect
pnpm gate3:hosted cleanup
```

Abandoned-run recovery remains separate and explicit:

```text
pnpm gate3:hosted recover --run gate3-...
```

The primary goal is to eliminate routine manual management of 20–30 environment variables while preserving or increasing the safety guarantees already proven by the hosted A9/A10/A11 and abandoned-run recovery work.

Version 1 is deliberately staging-only, target-bound, conservative, and optimized for deterministic reconciliation after interruption.

## 2. Process boundary

This is an architectural change because it introduces a control plane spanning persistent run state, hosted inspection, lifecycle policy, secret handling, resumable mutation runners, crash recovery, canonical cleanup, and compatibility with existing Gate 3 tooling.

Required Superpowers workflow:

1. approved architectural design;
2. written design specification;
3. specification self-review;
4. owner review of the written specification;
5. explicit owner approval;
6. invoke Superpowers `writing-plans`;
7. create a detailed implementation plan;
8. only after plan approval begin TDD implementation.

This document does not authorize implementation.

## 3. Goals

The orchestrator must:

- provide a small persistent CLI for the complete Gate 3 hosted lifecycle;
- make fresh hosted inspection the source of operational truth;
- preserve the manifest as evidence rather than mutable orchestration state;
- persist non-secret orchestration progress separately;
- persist only run-specific actor/moderator credentials in a Windows DPAPI-protected store;
- never persist Supabase admin/service-role or management credentials;
- bind each run immutably to the staging project, staging Worker origin, and deployed Worker release SHA;
- use deterministic versioned synthetic identities derived from `(runId, role)`;
- use cryptographically random passwords and TOTP secrets;
- resume safely after process crashes or operator interruption;
- never blindly replay an uncertain hosted mutation;
- execute A10 through small internal mutation checkpoints instead of rerunning the whole Playwright scenario;
- require exact scope proof before cleanup;
- preserve foreign synthetic accounts and unrelated hosted artifacts;
- keep abandoned-run recovery separate from normal cleanup;
- expose deterministic exit codes suitable for humans and automation;
- remain testable in CI without performing real hosted mutations.

## 4. Non-goals

Version 1 does not provide:

- production support;
- arbitrary Supabase project selection;
- arbitrary Worker URL selection;
- multi-environment orchestration;
- portable secret bundles;
- plaintext credential export;
- a recovery password;
- a cross-machine vault;
- automatic fallback from canonical cleanup to abandoned-run recovery;
- wildcard deletion;
- cleanup of unrelated synthetic accounts;
- blind retries;
- a `--force` path;
- a `--yes` path for cleanup or recovery;
- real hosted mutations from CI;
- removal of `pnpm a9:staging:provision` or `pnpm gate3:recovery` before the replacement lifecycle has been proven end to end.

## 5. Architectural boundaries

The subsystem is divided into six concepts with intentionally narrow responsibilities.

**Manifest = evidence.**

The Gate 3 manifest records exact verified hosted facts, identifiers, and provenance. It is not the mutable workflow engine.

**State JSON = orchestration.**

`gate3-run-state.json` records non-secret lifecycle progress, revisions, phase status, mutation checkpoints, target binding, and safe cached inspection summaries.

**DPAPI = secrets.**

The per-run DPAPI store contains only run-specific actor/moderator secrets that must survive restarts.

**Hosted inspection = truth.**

Fresh hosted evidence is authoritative for operational facts.

**Lifecycle engine = policy.**

The lifecycle layer determines the canonical run classification, allowed actions, and exact next safe step. It performs no mutation.

**Runners = mutations.**

Mutation runners execute only the exact action authorized by lifecycle policy and verify it before any later mutation is allowed.

No layer may silently absorb another layer's responsibilities.

## 6. Module boundaries

### 6.1 `gate3-hosted-cli.mjs`

Responsibilities:

- CLI parsing;
- operator UX;
- active-run or explicit `--run` selection;
- destructive approval interaction only after scope is proven;
- exit-code mapping.

It must not contain lifecycle policy, provider mutation logic, secret-store implementation, or hidden retry logic.

### 6.2 `gate3-hosted-state.mjs`

Responsibilities:

- validate and read `gate3-run-state.json`;
- atomic state writes;
- monotonic revisions;
- active-run pointer management;
- per-run exclusive stateful locks;
- archive metadata and run-location helpers.

It does not inspect hosted state and does not decide whether a hosted mutation is allowed.

### 6.3 `gate3-hosted-secrets.mjs`

Responsibilities:

- CSPRNG generation of passwords and TOTP secrets;
- creation of the run-specific secret payload;
- invocation of the minimal DPAPI helper through pipes;
- decryption of an existing store only when command capability permits it;
- safe metadata such as store status and optional ciphertext SHA-256.

It never persists or logs plaintext.

### 6.4 Minimal `gate3-dpapi.ps1`

The helper has exactly two operations:

- `protect`;
- `unprotect`.

It knows nothing about Gate 3, Supabase, actors, roles, manifests, or lifecycle states.

Plaintext travels only through stdin/stdout pipes between Node and the helper. Plaintext must never travel through CLI arguments, environment variables, temporary plaintext files, or logs. The helper never writes plaintext to disk.

### 6.5 `gate3-hosted-inspector.mjs`

Universal read-only source of truth.

It combines:

- validated local state;
- exact manifest plus SHA-256;
- current deployed Worker release evidence;
- read-only Supabase hosted evidence;
- run ownership evidence;
- foreign-artifact evidence.

It returns a canonical inspection result safe to serialize through `--json`.

It never has `--fix` behavior and never silently repairs local state.

### 6.6 `gate3-hosted-lifecycle.mjs`

Policy only.

Inputs are inspection facts plus validated orchestration metadata.

Outputs include:

- canonical lifecycle classification;
- exact allowed command set;
- exact next safe mutation step where applicable;
- sanitized reason code when blocked.

It performs no I/O mutation and receives no mutation capability.

### 6.7 `gate3-hosted-provision-runner.mjs`

Implements the orchestrated A9 path using existing proven A9 primitives.

It is fail-closed and resume-aware and must never create a second actor set for the same `runId`.

### 6.8 `gate3-hosted-scenario-runner.mjs`

Provides the reusable A10 internal step registry.

It executes exactly one lifecycle-authorized hosted mutation boundary at a time and never selects the next step itself.

### 6.9 `gate3-hosted-cleanup-runner.mjs`

Canonical A11 path.

Responsibilities include:

- fresh pre-cleanup inspection;
- exact scope verification;
- invocation-scoped explicit approval;
- resumable exact deletion;
- canonical post-check;
- independent hosted-zero verification;
- foreign-account preservation verification;
- DPAPI destruction after verified zero;
- archive finalization;
- active-pointer clearing.

### 6.10 `gate3-hosted-recovery-runner.mjs`

Wrapper around the proven abandoned-run recovery capability.

It is callable only when fresh lifecycle classification is `RECOVERY_REQUIRED`.

Normal cleanup never invokes it automatically.

## 7. Persistent run layout

The orchestrator reuses the existing Aromatika hosted-fixture storage root and archive convention rather than creating a second storage hierarchy.

Each active run has a dedicated run directory containing, at minimum:

```text
gate3-run-state.json
gate3-secrets.dpapi
<Gate 3 manifest at its recorded exact path>
```

The state file records the exact manifest path rather than assuming one from a mutable convention.

The storage root also contains an atomic active-run pointer.

Archived runs move to the established archive area only after verified cleanup finalization. The archive must never contain a live DPAPI secret store after canonical successful cleanup.

## 8. Persistent state model

`gate3-run-state.json` is non-secret orchestration state.

Conceptually it contains:

- `schemaVersion`;
- monotonic `revision`;
- `runId`;
- `createdAt`;
- immutable target binding:
  - project ref;
  - Worker origin;
  - deployed Worker release commit SHA;
- `identitySchemeVersion`;
- manifest metadata:
  - exact path;
  - current SHA-256;
- secret-store metadata:
  - exact path;
  - status;
  - optional ciphertext SHA-256;
- phase status:
  - preflight;
  - provision;
  - scenario;
  - cleanup;
  - recovery;
- A10 internal mutation checkpoints;
- safe cached `lastInspection`;
- archive metadata.

Actor IDs, report IDs, upload IDs, queue-row IDs, and other exact hosted artifact IDs are not duplicated into orchestration state. Those exact identifiers remain in the manifest.

The state file must never contain passwords, TOTP secrets, Supabase admin/service-role keys, access tokens, refresh tokens, session tokens, DPAPI plaintext, or raw provider responses containing sensitive data.

## 9. Atomic state persistence

Every successful state mutation increments `revision` monotonically.

State writes follow:

```text
serialize validated next state
→ write same-directory temporary file
→ flush file content
→ atomic replace/rename
→ verify readable replacement
```

The implementation plan must select Windows-compatible atomic-file semantics and test interruption behavior.

A corrupt or schema-invalid state file never authorizes hosted mutation.

When state cannot be trusted, the inspector may reconstruct facts from manifest evidence, hosted evidence, and immutable target evidence. Reconstruction does not silently overwrite corrupt state.

If evidence is insufficient for a unique safe classification, the lifecycle is `AMBIGUOUS`.

## 10. Manifest contract

The manifest is evidence, not mutable orchestration state.

After every hosted mutation represented by the manifest, required ordering is:

```text
hosted mutation
→ hosted read-back verification
→ atomic manifest write
→ atomic state write
```

An ID must never be written to the manifest merely because a provider request returned transport success. The hosted artifact must first be read back and verified as the exact intended run-owned artifact.

State records the current manifest SHA-256.

An unexplained manifest SHA mismatch is fail-closed.

## 11. Active-run model

The CLI supports an explicit selector:

```text
--run gate3-...
```

Without `--run`, commands use the atomic active-run pointer.

A stateful command must never select a run by newest timestamp, directory ordering, most recently modified file, or heuristic discovery.

`preflight` behavior:

- if there is an active unfinished run, resume it by default;
- do not silently create another run;
- an explicitly requested new run requires `--new`.

`--new` is an explicit operator choice, never an automatic fallback.

Changing the active pointer is atomic. The active pointer cannot switch while the current run holds a valid stateful lock.

Older non-active runs remain addressable only by exact `--run`.

## 12. Per-run concurrency and locking

The normal-lifecycle hosted-mutation commands are:

- `provision`;
- `scenario`;
- `cleanup`.

They require an exclusive per-run lock. Explicit `recover` is outside the normal lifecycle, but it must acquire the same exclusive per-run lock before any recovery mutation. `preflight` may mutate local control-plane files only; it performs no hosted mutation and must honor the active-pointer and lock rules.

Lock metadata contains only safe fields:

- `runId`;
- command;
- PID;
- `startedAt`.

`inspect` is read-only and may run while a stateful lock exists.

A lock is not considered stale merely because time passed. Stale-lock recovery requires both proof that the recorded PID no longer exists and a fresh read-only inspection.

No timeout-only lock deletion is allowed. Lock recovery itself performs no hosted mutation.

## 13. Version 1 target binding

Orchestrator v1 is hard-bound to staging.

Supabase project ref:

```text
nuhkpqjjyuygiemrxbdp
```

Staging Worker origin:

```text
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev
```

Version 1 does not accept `--project-ref` or `--worker-url`.

The purpose is to eliminate an entire class of wrong-target operator errors.

## 14. Release binding

`releaseCommitSha` means the SHA of the Worker code actually deployed to the bound staging Worker.

It never means the local orchestrator Git SHA or local worktree HEAD merely because that commit contains the CLI.

Preflight first resolves the deployed Worker SHA from the authoritative hosted source.

If authoritative resolution fails, the operator may provide:

```text
--release-sha <40hex>
```

The fallback must be exactly 40 hexadecimal characters.

The supplied SHA becomes the run's immutable release binding and does not weaken later checks.

If current authoritative deployed-release evidence differs from the bound SHA, lifecycle becomes `RELEASE_CHANGED`.

`RELEASE_CHANGED` blocks all hosted mutations. The orchestrator never silently rebinds the run to a newer deployment.

## 15. Preflight

`pnpm gate3:hosted preflight` performs local/control-plane preparation only.

It may:

- create/select a run ID;
- create the run directory;
- create initial orchestration state;
- establish the active pointer;
- create deterministic versioned synthetic identities;
- generate random actor credentials;
- protect run-specific secrets with DPAPI;
- reserve/create the manifest baseline;
- resolve and bind the deployed Worker SHA;
- verify staging Supabase/CLI/config identity and required read-only access;
- perform synthetic allow-list and absence checks.

Preflight must not create hosted Auth users or any other A9/A10/A11 hosted artifact and must not perform hosted deletion.

## 16. Synthetic identities

Synthetic email and username identity are deterministic from `(runId, role)` and versioned through `identitySchemeVersion`.

Passwords and TOTP secrets are CSPRNG-generated, independent of `runId`, non-derivable from deterministic identity, and persisted only inside the DPAPI-protected per-run store.

Before first provisioning, the expected synthetic identity set must pass both the explicit synthetic allow-list and a hosted absence check.

The orchestrator must not treat unrelated synthetic-looking accounts as current-run ownership.

Foreign synthetic accounts are preservation evidence, never deletion scope.

## 17. DPAPI secret-store lifecycle

Each run has:

```text
gate3-secrets.dpapi
```

It contains only run-specific actor/moderator credentials needed to resume the exact run.

Supabase admin/service-role/management credentials are never written into this store.

Privileged Supabase credentials are resolved on demand and kept only in memory for the shortest practical scope.

The authenticated Supabase CLI may resolve the project key through:

```text
pnpm dlx supabase projects api-keys --project-ref <ref> --reveal --output json
```

The implementation must parse the needed value in memory without printing it, persisting it, placing it into plaintext temp files, or echoing raw CLI output.

If DPAPI decryption fails for an already provisioned run:

- never generate replacement passwords;
- never generate replacement TOTP secrets;
- never overwrite existing ciphertext;
- canonical scenario execution is blocked;
- canonical cleanup is blocked when credential continuity is required;
- if exact recovery provenance remains provable, lifecycle becomes `RECOVERY_REQUIRED`;
- otherwise lifecycle becomes `AMBIGUOUS`.

After canonical cleanup passes both canonical and independent zero verification:

1. optionally record the ciphertext SHA-256;
2. destroy the DPAPI secret store;
3. set `secretStoreStatus = "destroyed-after-cleanup"`;
4. never archive live actor secrets.

## 18. Inspector contract

`pnpm gate3:hosted inspect` is the universal read-only diagnostic and classification command.

It may support:

```text
--json
```

It does not support `--fix`.

The inspector correlates, as required by the existing Gate 3 evidence model:

- selected run identity;
- state schema/revision;
- immutable target binding;
- active-run metadata where relevant;
- manifest path and SHA-256;
- manifest provenance;
- current deployed release;
- expected synthetic identity set;
- exact run-owned Auth users;
- sessions and MFA factors;
- profiles;
- reports;
- uploads;
- storage objects;
- cleanup queue rows;
- relevant Gate 3 hosted artifacts;
- foreign synthetic accounts/artifacts relevant to deletion-scope safety;
- persisted checkpoint evidence.

Hosted facts win over stale local assertions. Hosted facts do not automatically rewrite state.

A disagreement covered by a documented crash/reconciliation rule may be classified deterministically. An unexplained contradiction becomes `AMBIGUOUS`.

## 19. Canonical lifecycle classifications

The lifecycle engine returns exactly one primary classification from:

- `PREFLIGHT_READY`;
- `PROVISION_PARTIAL`;
- `PROVISION_VERIFIED`;
- `SCENARIO_PARTIAL`;
- `SCENARIO_VERIFIED`;
- `CLEANUP_REQUIRED`;
- `CLEANUP_PARTIAL`;
- `CLEANUP_VERIFIED`;
- `RECOVERY_REQUIRED`;
- `RELEASE_CHANGED`;
- `AMBIGUOUS`;
- `ARCHIVED`.

These are operational classifications, not merely display labels.

`RELEASE_CHANGED` and `AMBIGUOUS` are hard blockers for all hosted mutations.

`RECOVERY_REQUIRED` permits only explicit `recover`.

`ARCHIVED` is terminal and read-only.

Normal progress follows:

```text
PREFLIGHT_READY
→ PROVISION_PARTIAL | PROVISION_VERIFIED
→ SCENARIO_PARTIAL | SCENARIO_VERIFIED
→ CLEANUP_REQUIRED | CLEANUP_PARTIAL | CLEANUP_VERIFIED
→ ARCHIVED
```

`ARCHIVED` is terminal and read-only. For every non-archived run, lifecycle precedence is deterministic: unexplained `AMBIGUOUS` first, then proven `RELEASE_CHANGED`, then proven `RECOVERY_REQUIRED`, then the furthest uniquely proven normal lifecycle stage. Therefore `AMBIGUOUS` outranks `RELEASE_CHANGED`, and `RELEASE_CHANGED` outranks `RECOVERY_REQUIRED`; a changed release blocks every hosted mutation, including recovery. A state file alone can never override a higher-priority hosted blocker or prove a later stage by itself.

## 20. Provisioning model

`pnpm gate3:hosted provision` is a fail-closed, resume-aware A9 state machine.

Before mutation it acquires the per-run stateful lock and performs fresh hosted inspection.

Invariant:

```text
one runId
→ one deterministic expected role/identity set
→ never a second independently generated actor set
```

Cases:

**Zero expected actors:** provisioning may begin only after target/release binding, DPAPI availability, allow-list checks, and absence verification pass.

**Partial exact run:** reconcile existing exact run actors and resume only the proven missing/unfinished step. Never delete and restart merely to obtain a clean-looking run.

**Four verified actors:** read-only/no-op success. Never rotate credentials or recreate actors.

**Ambiguous actor evidence:** stop. No mutation. Never guess ownership.

## 21. A10 reusable scenario engine

The current A10 surface is one sequential Playwright test:

```text
tests/e2e/hosted-report-evidence.spec.ts
```

with ten logical scenarios.

A10 must be refactored into reusable internal primitives plus an explicit mutation-step registry.

Playwright remains an evidence/reporting layer and keeps the annotations:

```text
hosted_scenario_1
...
hosted_scenario_10
```

The numbered annotations are not sufficient resume checkpoints because multiple hosted mutation boundaries can exist within one logical scenario.

Internal mutation checkpoints are therefore separate and occur at every hosted mutation boundary. Representative checkpoints include:

- report-created;
- primary-upload-attached;
- duplicate-upload-created;
- duplicate-upload-reconciled;
- assignment-applied;
- manual-cleanup-verified;
- abandoned-upload-created;
- abandoned-upload-backdated;
- scheduled-cleanup-verified.

During implementation planning, the current A10 test must be inventoried mechanically so every hosted mutation boundary receives a stable internal step identifier before refactoring begins.

No mutation boundary may remain hidden inside an opaque "run scenario N" operation.

## 22. Scenario runner contract

For each allowed scenario step:

```text
acquire lock
→ fresh inspect
→ lifecycle determines exact next internal step
→ runner re-checks the step precondition
→ execute exactly that hosted mutation boundary
→ read back and verify
→ atomically persist manifest
→ atomically persist state
→ only then consider a later step
```

The runner never substitutes a different step when a precondition fails.

If a step fails, stop. Do not automatically replay it and do not silently continue.

The next invocation begins with fresh inspection.

If scenario is already fully verified, repeating `scenario` is a read-only/no-op success.

There is no `--force`.

## 23. One-mutation-boundary rule

A runner step receives capability for exactly one internal hosted mutation boundary.

Runner contract tests must prove:

- no mutation occurs before lifecycle approval;
- no second mutation boundary occurs before the first is verified and persisted;
- unknown outcome stops execution;
- runners cannot extend their own mutation or deletion scope.

A high-level `scenario` invocation may advance through multiple steps only by returning control to the orchestrator between boundaries and repeating the full inspect/policy/verify/persist sequence.

## 24. Transport and mutation outcome semantics

Transport outcome is not mutation truth:

```text
transport success ≠ verified mutation success
transport failure ≠ verified mutation failure
```

After every stateful hosted request, the orchestrator performs targeted read-back verification.

Possible outcomes:

**Confirmed intended mutation:** read-back proves the intended result; persist manifest/state.

**Confirmed no mutation:** read-back proves the requested mutation did not occur; return provider failure with confirmed no mutation.

**Outcome uncertain:** read-back proves neither success nor confirmed absence; stop with exit code `41`. Never retry automatically. Fresh `inspect` is required.

## 25. Mandatory mutation ordering

For every hosted mutation represented in evidence:

```text
hosted mutation
→ read-back verification
→ atomic manifest write
→ atomic state write
```

No later hosted mutation is allowed until all four stages complete for the current boundary.

This is a hard safety invariant.

## 26. Crash and restart semantics

For every mutation boundary, implementation and tests must handle these interruption windows.

**Before mutation:** no hosted change occurred; fresh inspect determines the same safe next step.

**After mutation / before verification:** outcome is unknown; fresh inspect reconciles hosted truth; never replay merely because local evidence is absent.

**After verification / before manifest:** fresh hosted inspection can rediscover the verified artifact; persist evidence without replay.

**After manifest / before state:** manifest plus hosted evidence outrank stale orchestration state for facts; reconstruct state without replay.

A10 scenario 8 requires explicit dedicated crash coverage.

## 27. Cleanup entry conditions

`pnpm gate3:hosted cleanup` is the normal canonical cleanup path only.

Before displaying any destructive confirmation prompt, it must already have:

- acquired the exclusive per-run lock;
- performed fresh inspection;
- verified exact run selection;
- verified exact staging project binding;
- verified exact Worker/release binding;
- verified the exact manifest path;
- verified the exact current manifest SHA-256;
- proven exact run-owned deletion scope;
- checked foreign artifacts/accounts that must remain untouched.

If exact scope cannot be proved, no confirmation prompt is shown and no deletion occurs.

## 28. Cleanup approval model

Cleanup approval is invocation-scoped.

The operator must type the exact `runId`.

A generic `y`, `yes`, persisted approval flag, prior approval, or environment variable is insufficient.

Approval is valid only for the current run, current invocation, and exact scope proven immediately before the prompt. Immediately before the first deletion, the runner re-checks the immutable target/release binding, manifest SHA-256, and exact scope. If any of those differ from the pre-prompt proof, approval is invalidated and the command stops without deleting anything. The same approval-invalidation rule applies to recovery.

There is no `--yes` and no persistent blanket approval.

If the operator declines or does not enter the exact run ID, no hosted deletion occurs.

## 29. Cleanup resume semantics

Cleanup is resumable.

After each deletion boundary:

```text
delete exact run-owned artifact
→ verify exact artifact absent
→ update manifest evidence
→ update state
```

If interrupted, the next invocation begins with fresh inspection and computes the exact residual run-owned set.

It never assumes the original deletion set still exists, never performs wildcard cleanup, never deletes by naming pattern alone, never deletes foreign run IDs, and never restarts from zero.

Foreign synthetic accounts are explicitly verified preserved.

## 30. Cleanup completion

Canonical cleanup is complete only after:

1. canonical post-check;
2. independent hosted-zero verification for current-run artifacts;
3. foreign synthetic-account/artifact preservation verification;
4. optional DPAPI ciphertext SHA-256 evidence;
5. DPAPI store destruction;
6. state update recording secret destruction;
7. archival of non-secret evidence;
8. clearing the active-run pointer when it points to this run.

The archived run preserves non-secret state/evidence, manifest evidence, hashes/provenance, and lifecycle completion metadata. It does not preserve live actor passwords or TOTP material.

## 31. Recovery model

Normal cleanup never automatically falls back to abandoned-run recovery.

`pnpm gate3:hosted recover --run gate3-...` is available only when a fresh inspector result is exactly:

```text
RECOVERY_REQUIRED
```

Recovery flow:

```text
fresh inspection
→ recovery dry-run
→ checkpoint
→ exact scope verification
→ explicit approval
→ exact cleanup
→ independent verification
→ non-secret archive finalization
```

The wrapper must reuse the existing proven abandoned-run recovery capability rather than creating a second unrelated deletion implementation.

The same no-wildcard and foreign-artifact preservation rules apply.

There is no `--yes` for recovery.

## 32. CLI flags

Approved flags:

- `--run gate3-...`;
- `--new`;
- `--release-sha <40hex>`;
- `--json`.

Flags are command-scoped and unsupported combinations are rejected rather than ignored.

Version 1 must not add, directly or through hidden aliases/environment variables:

- `--force`;
- `--project-ref`;
- `--worker-url`;
- `--skip-inspect`;
- `--skip-verification`;
- `--retry`;
- `--cleanup-all`;
- `--yes` for cleanup/recovery.

## 33. Exit codes

- `0` — verified success or safe no-op;
- `10` — precondition not met;
- `20` — `AMBIGUOUS`;
- `21` — `RELEASE_CHANGED`;
- `22` — `RECOVERY_REQUIRED`;
- `30` — destructive approval declined;
- `40` — provider failure with confirmed no mutation;
- `41` — mutation outcome uncertain; inspect required before any retry.

Exit `41` is specifically non-retryable without fresh inspection.

## 34. Capability-based privilege model

Commands receive only the capabilities they require.

**Inspect:** read-only local and hosted evidence; no mutation capability.

**Preflight:** local/control-plane setup only; no hosted mutation capability.

**Provision:** only A9 capabilities required for the exact authorized step.

**Scenario:** only the exact A10 step capability selected by lifecycle.

**Cleanup:** only exact run-owned cleanup capabilities after scope proof and approval.

**Recovery:** only abandoned-run recovery capabilities when lifecycle is `RECOVERY_REQUIRED`.

A module that does not need a secret or mutation function does not receive it for convenience.

## 35. Logging and secret handling

Logging is allow-list based.

Safe fields include:

- run ID;
- lifecycle classification;
- safe counts;
- role names;
- SHA values;
- checkpoint names;
- sanitized reason/error codes;
- non-secret phase status.

Normal logs and `--json` output must not contain actor emails, passwords, TOTP secrets, API keys, access/refresh/session tokens, raw provider bodies, DPAPI plaintext, or DPAPI ciphertext.

Provider errors are untrusted potentially-sensitive input and must be sanitized before ordinary logging.

## 36. Inspection versus repair

Inspection is strictly read-only.

If state and hosted evidence disagree:

- hosted evidence wins for facts;
- `inspect` does not rewrite state;
- a documented crash window may classify deterministically;
- unexplained disagreement becomes `AMBIGUOUS`.

Any local convergence required after a known crash window occurs only through an explicit stateful command path after fresh inspection.

There is no hidden `inspect --fix`.

## 37. Testing strategy

CI must prove orchestration behavior without real hosted mutations.

### 37.1 Unit tests

Required coverage includes:

- lifecycle classification and allowed next commands;
- state transitions;
- blocker precedence;
- `RELEASE_CHANGED`;
- `AMBIGUOUS`;
- `RECOVERY_REQUIRED`;
- active-run selection and explicit `--run`;
- `--new` behavior;
- active-pointer atomicity;
- locks and stale-lock PID checks;
- monotonic atomic revisions;
- corrupt-state fail-closed behavior;
- manifest SHA binding;
- deterministic versioned identities;
- random secret-generation contract;
- exit-code mapping;
- logging allow-list behavior.

### 37.2 Runner contract tests

Required tests prove:

- no hosted mutation before lifecycle approval;
- maximum one mutation boundary per runner step;
- exact ordering `mutation → verification → manifest → state`;
- no later mutation before prior persistence;
- unknown outcome returns exit `41`;
- no automatic replay;
- residual cleanup uses exact IDs;
- foreign IDs can never enter deletion scope.

### 37.3 Windows DPAPI tests

On Windows CI where available, test:

- protect/unprotect round-trip;
- corrupted ciphertext fail-closed behavior;
- wrong/unavailable DPAPI context fail-closed behavior where deterministically testable;
- no plaintext logs;
- no plaintext temp files;
- no secret in CLI arguments.

The test suite must not print fixture secrets when a test fails.

### 37.4 Crash/restart matrix

For every hosted mutation boundary, test interruption:

- before mutation;
- after mutation/before verification;
- after verification/before manifest;
- after manifest/before state.

Expected result is reconciliation through inspection, never blind replay.

A10 scenario 8 has additional dedicated crash tests.

### 37.5 Inspector tests

Fake hosted adapters verify:

- hosted truth overrides stale phase claims;
- explainable crash windows classify deterministically;
- conflicting ownership becomes `AMBIGUOUS`;
- release mismatch becomes `RELEASE_CHANGED`;
- foreign synthetic accounts stay separate;
- corrupt state alone never authorizes mutation;
- manifest mismatch blocks mutation unless a specifically tested crash-reconstruction rule safely explains it.

### 37.6 Local/mock Playwright

The A10 Playwright reporting layer uses the same reusable A10 primitives as the orchestrator.

Normal CI must not require real hosted mutation.

### 37.7 Full repository verification

Before implementation is complete:

```text
focused tests
→ affected suites
→ local/mock Playwright as applicable
→ full pnpm test
→ required repository CI
```

Real hosted acceptance remains separate and explicit.

## 38. No real hosted mutation in CI

Repository CI must not create staging users, reports, uploads, assignments, backdated rows, A11 cleanup actions, or abandoned-run recovery mutations.

CI uses unit tests, fake adapters, contract tests, Windows DPAPI tests, and local/mock Playwright.

## 39. Implementation phases

### Phase 1 — control plane

Implement state, atomic persistence, active pointer, locks, DPAPI, deterministic identities, release binding, lifecycle, `preflight`, and `inspect`.

Phase 1 performs no hosted mutation.

### Phase 2 — A9

Implement `provision`, resume/reconcile behavior, the exact actor-set invariant, and reuse of existing A9 primitives.

### Phase 3 — A10

Implement reusable A10 primitives, the complete internal mutation-checkpoint registry, scenario runner, the Playwright wrapper using the same primitives, and crash/restart coverage including scenario 8.

### Phase 4 — cleanup/recovery

Implement canonical cleanup, partial-cleanup resume, independent hosted-zero verification, foreign-account preservation, DPAPI destruction, archive, active-pointer clearing, and the explicit recovery wrapper.

### Phase 5 — explicit real hosted acceptance

Run one new clean Gate 3 lifecycle:

```text
preflight
→ inspect
→ provision
→ inspect
→ scenario
→ inspect
→ cleanup
→ independent zero verification
→ archive
```

This hosted acceptance is explicit operator-controlled work and is not ordinary CI.

## 40. Backward compatibility

Until the new orchestrator proves the complete real hosted lifecycle, preserve:

```text
pnpm a9:staging:provision
pnpm gate3:recovery
```

Do not delete or silently redirect these commands during early phases.

Existing proven primitives may be reused internally, but compatibility entry points remain operational until replacement acceptance is complete.

## 41. Migration principle

Reuse proven A9 and recovery primitives instead of unnecessarily rewriting security-sensitive provider behavior.

A10 must be refactored because the current single sequential Playwright test is not safely resumable at mutation-boundary granularity.

The refactor preserves existing evidence semantics while moving mutation logic into independently testable primitives.

No unrelated application feature refactoring belongs in this project.

## 42. Security invariants

Hard requirements:

- never ask the operator to paste secrets into chat;
- never print passwords or TOTP secrets;
- never persist Supabase service/admin keys;
- never persist access tokens;
- never write plaintext DPAPI payloads to disk;
- never perform wildcard cleanup;
- never delete based only on naming patterns;
- never delete foreign synthetic accounts;
- never blindly rerun A11;
- never blindly replay after exit `41`;
- never mutate under `AMBIGUOUS`;
- never mutate under `RELEASE_CHANGED`;
- allow recovery only under `RECOVERY_REQUIRED`;
- require exact run ID approval before destructive cleanup/recovery;
- require read-back verification after hosted stateful operations.

Tests encode these invariants wherever practical.

## 43. Windows PowerShell 5.1 operator compatibility

Operator workflows must remain reliable under Windows PowerShell 5.1.

Native command handling must account for:

- `$LASTEXITCODE` being meaningful only after a native command actually executed;
- `CommandNotFoundException` not constituting a valid native exit code;
- harmless native stderr not proving command failure;
- temporary use of `$ErrorActionPreference = 'Continue'` around native commands where needed to avoid benign stderr becoming terminating `NativeCommandError`;
- preserving useful live output instead of hiding long-running output without reason.

Repository text-file writes performed through PowerShell 5.1 must explicitly control encoding. Where UTF-8 without BOM is required, implementation/operator scripts must use an API that actually provides UTF-8 without BOM on Windows PowerShell 5.1 rather than assuming newer PowerShell encoding names are available.

## 44. Success criteria

The design is successfully implemented only when all of the following are true:

- a clean run can be created through `preflight` without hosted mutation;
- `inspect` accurately reports local/hosted lifecycle truth read-only;
- provisioning is resumable and never creates a second actor set for one run;
- interrupted A9 reconciles instead of restarting blindly;
- A10 executes through internal mutation checkpoints;
- interrupted A10 never blindly replays uncertain mutation;
- Playwright evidence and orchestrator share the same A10 primitives;
- canonical cleanup proves exact scope before prompting;
- partial cleanup resumes only exact residual artifacts;
- foreign synthetic accounts remain untouched;
- successful cleanup has canonical and independent hosted-zero verification;
- live DPAPI secrets are destroyed only after verified hosted zero;
- archived evidence contains no live secret store;
- changed Worker release blocks hosted mutation;
- ambiguous evidence blocks hosted mutation;
- lost credential continuity routes to explicit recovery only when recovery provenance remains exact;
- normal CI remains mutation-free;
- one explicit fresh staging Gate 3 acceptance run completes end to end;
- existing A9/recovery entry points remain available until replacement acceptance proves safe migration.

## 45. Implementation-plan handoff

The architecture and safety decisions required before planning are closed.

The `writing-plans` phase must map this design onto exact current repository files and functions by identifying:

- exact A9 primitives to reuse;
- exact manifest writer/validator surfaces;
- the authoritative deployed-release resolver, or the minimal read-only resolver required by this design;
- every current A10 hosted mutation boundary and its stable internal checkpoint name;
- exact abandoned-run recovery primitives to wrap;
- exact test files to extend or create.

These are implementation mappings, not unresolved architectural decisions.

Before this written specification is committed, it must pass the required self-review for placeholders, contradictions, ambiguity, and scope, with any findings fixed inline. The owner then reviews the committed written file. Only after explicit owner approval may Superpowers `writing-plans` be invoked.

Implementation must not begin before that approval.
