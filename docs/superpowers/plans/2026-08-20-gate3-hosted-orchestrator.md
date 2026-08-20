# Gate 3 Persistent Hosted Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the staging-only persistent Gate 3 hosted orchestrator through repository-safe phases 1–4, while preserving existing A9/recovery entry points and leaving the real hosted acceptance run as an explicit owner-gated operation.

**Architecture:** The CLI selects an exact run, the state module owns non-secret local orchestration, DPAPI owns resumable actor secrets, the inspector produces fresh read-only truth, lifecycle policy authorizes exactly one next boundary, and runners receive only the capability for that boundary. Existing A9, A10, A11, and abandoned-run recovery primitives are reused or narrowed rather than replaced wholesale; manifest evidence is always persisted before orchestration state after a verified hosted mutation.

**Tech Stack:** Node.js 22 ESM, PowerShell 5.1/.NET DPAPI, Vitest 4, Playwright 1.61, Supabase JS 2.110, Supabase SQL/pgTAP, Deno Edge Functions, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-19-gate3-hosted-orchestrator-design.md`

## Global Constraints

- Risk is R2 because the work handles service-role access, actor credentials, MFA, private report evidence, and exact deletion scope.
- The only hosted target is Supabase project `nuhkpqjjyuygiemrxbdp` and Worker origin `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev`.
- Run storage remains under `%LOCALAPPDATA%\Aromatika\hosted-fixtures`; active runs live in `active\<runId>` and verified archives live in the existing `archive\<runId>` area.
- Manifest means verified hosted evidence; `gate3-run-state.json` means non-secret orchestration; `gate3-secrets.dpapi` means only resumable run actor credentials.
- Hosted truth overrides stale local phase claims, but read-only inspection never rewrites local files.
- Every stateful command acquires the exact run lock, performs fresh inspection, asks lifecycle for one exact boundary, verifies the boundary, persists manifest evidence, then persists state.
- No automatic retry follows an uncertain mutation. Exit `41` requires a later fresh `inspect`.
- The only accepted CLI flags are command-scoped uses of `--run`, `--new`, `--release-sha`, and `--json`; all hidden or explicit force/skip/retry/wildcard/blanket-approval paths are rejected.
- Normal CI uses injected fake adapters and local/mock Playwright only. No CI command may create or delete hosted users, reports, uploads, queue rows, objects, assignments, or recovery artifacts.
- Keep `pnpm a9:staging:provision` and `pnpm gate3:recovery` unchanged until a separate real hosted acceptance proves replacement safety.
- Do not print, serialize to normal output, or persist service/admin/management keys, actor emails, passwords, TOTP secrets, access/refresh/session tokens, provider bodies, DPAPI plaintext, or DPAPI ciphertext.
- PowerShell-authored repository text is UTF-8 without BOM. Native PowerShell 5.1 command wrappers distinguish command-not-found, native exit code, and harmless stderr correctly.
- Every behavioral change follows strict RED -> GREEN -> REFACTOR, with the failing test output captured in the task report before production code is written.

## Implementation Rulings From Current Repository Evidence

1. The existing hosted-fixture root is `%LOCALAPPDATA%\Aromatika\hosted-fixtures`, and the existing archive area is its `archive` child. The orchestrator introduces only an `active` child and `active-run.json` pointer inside that same root.
2. `x-deployed-git-sha` from the bound staging Worker is the authoritative deployed release evidence. `--release-sha` is accepted only when that read-only request fails, and hosted mutation remains blocked until a later fresh authoritative check proves the same SHA.
3. Supabase Auth generates the TOTP enrollment secret and the pinned SDK accepts no caller-supplied TOTP secret. `gate3-hosted-secrets.mjs` therefore CSPRNG-generates passwords, validates the provider-generated base32 TOTP secret, and DPAPI-persists it immediately. It must not fabricate an unenrollable TOTP seed or write directly to Supabase Auth internals.
4. Authentication and AAL elevation are ephemeral capability acquisition, not durable Gate 3 artifact boundaries. Sessions and tokens are never persisted. Durable Auth user creation, onboarding/role/factor state, reports, uploads, assignments, queue transitions, object deletion, and account deletion are lifecycle boundaries.
5. The primary `/report` POST is one operator-controlled HTTP mutation boundary that may produce a report plus its attached upload/object. Its targeted read-back verifies the complete intended result, and uncertain transport is reconciled by exact actor/run provenance before replay is considered. The registry still records separate read-only evidence checkpoints for report creation and attachment metadata.
6. The existing upload-cleanup Edge Function claims a global batch and is not an exact-run capability. Add an exact-coordinate request mode and a service-role-only exact claim RPC while preserving the scheduled no-body batch mode.

## Existing Implementation and Risk Map

- **A9 entry point and compatibility boundary:** `scripts/hosted-a9-runner.mjs` exports `validateHostedA9RunnerEnvironment()`, `runHostedA9Provisioning()`, and `runHostedA9Cli()`. It calls `createSupabaseHostedA9Adapters()`, `createHostedRunManifest()`, `executeHostedA9Provisioning()`, and `persistHostedRunManifest()` from `scripts/hosted-report-evidence-operator.mjs`. Tests: `tests/scripts/hosted-a9-runner.test.ts` and `tests/scripts/hosted-a9-provisioning.test.ts`. High-risk coupling: the current runner provisions all roles and rolls back in one invocation, so new resumable exports must not change this compatibility path.
- **Manifest authority:** `createHostedRunManifest()` (line 407), registration helpers, `persistHostedRunManifest()` (line 664), and `loadHostedRunManifest()` in `scripts/hosted-report-evidence-operator.mjs` already own exact actor/report/upload/queue evidence and private atomic writes. Tests: `tests/scripts/hosted-report-evidence-operator.test.ts`. High-risk coupling: manifest schema and target validation are shared by A9, A10, A11, and recovery; extensions must preserve old manifests and callers.
- **A9 provider primitives:** `executeHostedA9Provisioning()` (line 1792), `createSupabaseHostedA9Adapters()`, and `createSupabaseHostedEvidenceAdapters()` already cover Auth create/delete, sessions, onboarding, moderator role/MFA, and targeted reads. High-risk coupling: Supabase owns TOTP-secret generation and provider transport may be uncertain; new single-role operations must reuse the existing validation/sanitization behavior.
- **A10 hosted entry point:** `tests/e2e/hosted-report-evidence.spec.ts` contains the ten annotated scenarios and helpers including `submitEvidenceReport()`, Storage reads, exact RPC calls, hostile multipart requests, and `processCleanupQueue()`. The `/report` action in `src/routes/report/+page.server.ts` performs allocation, Storage upload, finalize, report insert, and evidence attachment inside one operator-controlled HTTP request. High-risk coupling: `processCleanupQueue()` currently invokes a global batch and must not become an exact-run capability until Task 8; actor authorization assertions must continue using actor sessions rather than service-role reads.
- **A10 mutation inventory:** the stable registry in Task 9 covers the primary report request and attachment proof; cross-user denial; duplicate denial, allocation, and reconciliation; assignment; rejected-evidence fixture creation and exact manual cleanup; abandoned allocation, object creation, backdate, and scheduled cleanup; and the six hostile no-side-effect requests. Ephemeral sign-in/AAL acquisition is excluded by ruling 4, but its resulting authorization level remains a required step precondition.
- **Cleanup:** `cleanupHostedRun()` (line 2636) and `cleanupHostedManifestFile()` in `scripts/hosted-report-evidence-operator.mjs` already inspect/remove/reinspect a manifest scope. Tests: `tests/scripts/hosted-report-evidence-operator.test.ts`. High-risk coupling: the current batch removal is too coarse for resumable A11 and may not be called by the new exact-boundary runner.
- **Upload-cleanup worker:** `supabase/functions/upload-cleanup/index.ts` validates a shared secret, expires uploads, calls `claim_upload_cleanup(integer,text)`, removes Storage objects, and completes/fails leases. The queue ID is `bigint` and worker request ID is `text`. Tests/contracts: `tests/contracts/upload-cleanup.contract.test.ts`, `supabase/tests/beta-hardening.contract.test.mjs`, `supabase/tests/beta_hardening.pgtap.sql`, and `supabase/tests/report_evidence_hardening.pgtap.sql`. High-risk coupling: empty-body scheduled behavior must remain byte-compatible while exact mode cannot claim foreign work.
- **Recovery:** `scripts/hosted-abandoned-run-recovery.mjs` owns validation, dry-run provenance, checkpoints, and cleanup; `scripts/hosted-abandoned-run-recovery-runner.mjs` and `scripts/hosted-abandoned-run-recovery-cli.mjs` are the compatibility entry points. Tests: the three matching `tests/scripts/hosted-abandoned-run-recovery*.test.ts` files. High-risk coupling: normal cleanup must not import or automatically fall back to recovery.
- **Private file and target helpers:** `resolveOutsideRepositoryFile()`, `atomicPrivateWrite()`, and `reservePrivateFile()` in `scripts/hosted-private-file.mjs` are reusable; `verifyStagingTarget()` in `scripts/staging-db-operator.mjs` already verifies the linked Frankfurt project and sanitizes Supabase CLI output. High-risk coupling: state replacement additionally needs flush/read-back verification, and provider key responses must remain in memory only.
- **Release evidence:** the staging Worker emits `x-deployed-git-sha`; `scripts/smoke-staging.mjs` validates an expected SHA but does not expose a reusable resolver. Task 5 adds the minimal bound-origin read-only resolver rather than coupling the orchestrator to smoke-test control flow.

## Interface Map

```javascript
// scripts/gate3-hosted-state.mjs
resolveGate3RunPaths({ root, runId })
createInitialRunState({ runId, createdAt, releaseCommitSha, manifestPath, secretPath })
readRunState(paths)
reserveRunState(paths, state)
writeNextRunState(paths, currentState, nextState)
readActiveRun(root)
setActiveRun({ root, runId, expectedCurrentRunId })
clearActiveRun({ root, runId })
acquireRunLock({ paths, command, pid, startedAt })
inspectRunLock({ paths, isPidRunning })
recoverStaleRunLock({ paths, observedLock, inspection })
archiveVerifiedRun({ paths, state, manifestBytes })

// scripts/gate3-hosted-secrets.mjs
deriveSyntheticIdentity({ runId, role, identitySchemeVersion })
createRunSecretPayload({ runId, randomBytesImpl })
protectRunSecrets({ payload, path, dpapi })
unprotectRunSecrets({ runId, path, dpapi })
recordProviderTotpSecret({ payload, role, secret })
destroyRunSecretStore(path)
createPowerShellDpapi({ scriptPath, spawnImpl })

// scripts/gate3-hosted-lifecycle.mjs
classifyGate3Lifecycle(inspection)
allowedCommandsFor(classification)
selectNextProvisionStep(inspection)
selectNextScenarioStep(inspection)
selectNextCleanupStep(inspection)

// scripts/gate3-hosted-inspector.mjs
resolveDeployedRelease({ workerOrigin, fetchImpl })
resolveStagingApiKeys({ runSupabaseCli })
inspectGate3Run({ selection, capabilities, now })
verifyIndependentHostedZero({ inspection, adapters })

// scripts/gate3-hosted-*-runner.mjs
runProvisionBoundary({ inspection, authorization, capabilities })
runScenarioBoundary({ inspection, authorization, capabilities })
prepareCleanupApproval({ inspection })
runCleanupBoundary({ inspection, authorization, capabilities })
runRecoveryBoundary({ inspection, authorization, capabilities })

// scripts/gate3-hosted-cli.mjs
parseGate3HostedArgs(argv)
runGate3HostedCli({ argv, environment, dependencies, input, output, errorOutput })
```

---

### Task 1: Local run paths, validated state, atomic revisions, and active pointer

**Files:**
- Modify: `.gitignore`
- Modify: `scripts/hosted-private-file.mjs`
- Create: `scripts/gate3-hosted-state.mjs`
- Create: `tests/scripts/gate3-hosted-state.test.ts`
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`

**Interfaces:**
- Consumes: `atomicPrivateWrite()` and `reservePrivateFile()` from `scripts/hosted-private-file.mjs`.
- Produces: the state/path/pointer functions in the Interface Map; `Gate3HostedStateError` with safe `reasonCode` values.

- [ ] **Step 1: Write failing path and schema tests**

```typescript
it('maps an exact run into the established Aromatika hosted-fixture root', () => {
  expect(resolveGate3RunPaths({ root, runId: 'gate3-20260820-abcdef12' })).toEqual({
    root,
    activeRoot: join(root, 'active'),
    archiveRoot: join(root, 'archive'),
    runId: 'gate3-20260820-abcdef12',
    runDirectory: join(root, 'active', 'gate3-20260820-abcdef12'),
    archiveDirectory: join(root, 'archive', 'gate3-20260820-abcdef12'),
    statePath: join(root, 'active', 'gate3-20260820-abcdef12', 'gate3-run-state.json'),
    secretPath: join(root, 'active', 'gate3-20260820-abcdef12', 'gate3-secrets.dpapi'),
    manifestPath: join(root, 'active', 'gate3-20260820-abcdef12', 'gate3-run-manifest.json'),
    lockPath: join(root, 'active', 'gate3-20260820-abcdef12', '.gate3.lock'),
    activePointerPath: join(root, 'active-run.json')
  });
});

it.each(['gate3-x', '../gate3-escape', 'GATE3-20260820-abcdef12'])(
  'rejects unsafe run id %s',
  (runId) => expect(() => resolveGate3RunPaths({ root, runId })).toThrow('run_id_invalid')
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-state.test.ts`

Expected: FAIL because `scripts/gate3-hosted-state.mjs` does not exist.

- [ ] **Step 3: Implement exact paths and state validation**

Implement schema version `1`, the exact target binding, manifest/secret metadata, five phase records, scenario checkpoint map, safe cached inspection, and archive metadata. Reject unknown top-level keys, non-integer or negative revisions, path escape, symlink/reparse targets, secret-shaped keys, and any immutable binding change.

```javascript
export const GATE3_STATE_SCHEMA_VERSION = 1;
export const GATE3_PROJECT_REF = 'nuhkpqjjyuygiemrxbdp';
export const GATE3_WORKER_ORIGIN =
  'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';

export function createInitialRunState({
  runId,
  createdAt,
  releaseCommitSha,
  manifestPath,
  secretPath
}) {
  return Object.freeze({
    schemaVersion: 1,
    revision: 0,
    runId,
    createdAt,
    target: Object.freeze({
      projectRef: GATE3_PROJECT_REF,
      workerOrigin: GATE3_WORKER_ORIGIN,
      releaseCommitSha
    }),
    identitySchemeVersion: 1,
    manifest: Object.freeze({ path: manifestPath, sha256: null }),
    secretStore: Object.freeze({ path: secretPath, status: 'missing', ciphertextSha256: null }),
    phases: Object.freeze({
      preflight: Object.freeze({ status: 'pending', checkpoint: null }),
      provision: Object.freeze({ status: 'pending', checkpoint: null }),
      scenario: Object.freeze({ status: 'pending', checkpoint: null }),
      cleanup: Object.freeze({ status: 'pending', checkpoint: null }),
      recovery: Object.freeze({ status: 'pending', checkpoint: null })
    }),
    scenarioCheckpoints: Object.freeze({}),
    lastInspection: null,
    archive: null
  });
}
```

- [ ] **Step 4: Add RED tests for atomic revision and pointer behavior**

Test these exact cases: initial reserve is exclusive; next state must be `revision + 1`; immutable run/target/manifest/secret paths cannot change; corrupt JSON and invalid schema fail closed; replacement is flushed, renamed, read back, and byte-equivalent; pointer compare-and-swap rejects a changed current run; pointer never selects by timestamps or directory order; `.codegraph/` and `.atl/` are ignored local tool output.

- [ ] **Step 5: Implement atomic state and pointer writes**

Extend `atomicPrivateWrite(filePath, contents, { verify })` so callers can read and validate the replacement after rename without weakening existing callers. Use same-directory temporary files, `FileHandle.sync()`, rename, permissions, read-back validation, and sanitized errors.

- [ ] **Step 6: Run focused tests and affected manifest tests**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-state.test.ts tests/scripts/hosted-report-evidence-operator.test.ts`

Expected: PASS with no plaintext/provider output in failures.

- [ ] **Step 7: Refactor and commit**

Run: `git add .gitignore scripts/hosted-private-file.mjs scripts/gate3-hosted-state.mjs tests/scripts/gate3-hosted-state.test.ts tests/scripts/hosted-report-evidence-operator.test.ts && git commit -m "feat: add Gate 3 persistent run state"`

---

### Task 2: Per-run locking, stale-lock proof, and non-secret archival

**Files:**
- Modify: `scripts/gate3-hosted-state.mjs`
- Modify: `tests/scripts/gate3-hosted-state.test.ts`

**Interfaces:**
- Consumes: Task 1 run paths and atomic state/pointer functions.
- Produces: exact per-run lock acquisition/release, PID-backed stale-lock recovery, and two-stage archive finalization.

- [ ] **Step 1: Write failing lock contract tests**

```typescript
it('does not treat elapsed time as stale while the recorded pid exists', async () => {
  await writeFile(paths.lockPath, JSON.stringify({
    runId, command: 'scenario', pid: 77, startedAt: '2026-08-19T00:00:00.000Z'
  }));
  await expect(inspectRunLock({ paths, isPidRunning: (pid) => pid === 77 }))
    .resolves.toMatchObject({ status: 'held' });
});

it('requires a fresh read-only inspection before removing a dead-pid lock', async () => {
  const observed = await inspectRunLock({ paths, isPidRunning: () => false });
  await expect(recoverStaleRunLock({ paths, observedLock: observed, inspection: null }))
    .rejects.toThrow('fresh_inspection_required');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-state.test.ts -t "lock|archive"`

Expected: FAIL because lock/archive functions are absent.

- [ ] **Step 3: Implement lock ownership and safe release**

Reserve `.gate3.lock` with `wx`; store only `runId`, `command`, `pid`, `startedAt`; reject unsupported commands; release only when current bytes still equal the acquired bytes. PID probing uses an injected `isPidRunning` in tests and `process.kill(pid, 0)` in production. Access-denied means alive; only ESRCH means absent.

- [ ] **Step 4: Add RED archive crash-window tests**

Cover: cleanup not independently verified; secret file still present; archive destination exists; crash after archive-pending state write; crash after directory rename; active pointer references another run; archived state terminal/read-only; live DPAPI file never appears under archive.

- [ ] **Step 5: Implement resumable archive finalization**

```text
state cleanup verified + independent zero verified
-> confirm gate3-secrets.dpapi absent
-> persist archive.status=pending and archive destination
-> same-volume rename active/<runId> to archive/<runId>
-> persist archive.status=complete inside archived directory
-> clear active pointer only if it still equals runId
```

- [ ] **Step 6: Run state tests and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-state.test.ts`

Expected: PASS.

Run: `git add scripts/gate3-hosted-state.mjs tests/scripts/gate3-hosted-state.test.ts && git commit -m "feat: add Gate 3 run locks and archival"`

---

### Task 3: Deterministic identities and DPAPI-only run secrets

**Files:**
- Create: `scripts/gate3-dpapi.ps1`
- Create: `scripts/gate3-hosted-secrets.mjs`
- Create: `tests/scripts/gate3-hosted-secrets.test.ts`
- Create: `tests/scripts/gate3-dpapi.windows.test.ts`

**Interfaces:**
- Consumes: Task 1 exact secret path.
- Produces: deterministic version-1 identities, random passwords, provider-TOTP validation/update, DPAPI protect/unprotect through binary stdin/stdout, ciphertext hash/status, and verified destruction.

- [ ] **Step 1: Write failing deterministic identity and randomness tests**

```typescript
const runId = 'gate3-20260820-abcdef12';

it('derives stable versioned identities without embedding a password', () => {
  expect(deriveSyntheticIdentity({ runId, role: 'assigned-moderator', identitySchemeVersion: 1 }))
    .toEqual({
      role: 'assigned-moderator',
      email: 'gate3-v1-mod-a-a8f5c2720cc35a38@example.invalid',
      username: 'g3_v1_mod_a_a8f5c2720cc35a38'
    });
});

it('uses independent random bytes for every actor password', () => {
  const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
  expect(new Set(Object.values(payload.actors).map((actor) => actor.password)).size).toBe(4);
  expect(JSON.stringify(payload)).not.toContain('SUPABASE_');
});
```

Use `sha256("gate3-identity-v1\0<runId>\0<role>")`, the first 16 lowercase hex characters, role tokens `rep`, `cross`, `mod-a`, `mod-u`, email `gate3-v1-<token>-<digest>@example.invalid`, and username `g3_v1_<token with hyphen replaced by underscore>_<digest>`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-secrets.test.ts`

Expected: FAIL because the secrets module is absent.

- [ ] **Step 3: Implement identity, password, and payload validation**

Passwords are `G3!` plus 32 random bytes encoded base64url. The secret payload contains `schemaVersion`, `runId`, `identitySchemeVersion`, and exactly four role records. Moderator `totpSecret` starts `null`, becomes a validated uppercase base32 secret only after Supabase enrollment, and is never returned by metadata/output helpers.

- [ ] **Step 4: Write failing DPAPI invocation tests**

Assert the child command receives only `protect` or `unprotect`; plaintext is written only to stdin; ciphertext/plaintext is read only from stdout; stderr is never echoed; no secret is present in arguments, environment additions, temporary files, logs, error messages, JSON output, or snapshots.

- [ ] **Step 5: Implement the two-operation PowerShell helper**

`gate3-dpapi.ps1` accepts exactly `protect` or `unprotect`, reads raw bytes from `[Console]::OpenStandardInput()`, calls `[System.Security.Cryptography.ProtectedData]` with `DataProtectionScope.CurrentUser`, and writes raw bytes to `[Console]::OpenStandardOutput()`. It creates no file and emits no plaintext diagnostic.

- [ ] **Step 6: Implement Node DPAPI piping and atomic ciphertext writes**

Use `spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',scriptPath,operation], { stdio: ['pipe','pipe','pipe'], windowsHide: true })`; enforce a bounded ciphertext size; hash ciphertext with SHA-256; use atomic binary same-directory replacement; decrypt only for provision/scenario capability; zero buffers in `finally` where Node permits.

- [ ] **Step 7: Run cross-platform and Windows-only tests**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-secrets.test.ts tests/scripts/gate3-dpapi.windows.test.ts`

Expected on Windows: protect/unprotect round-trip PASS; corrupt ciphertext PASS by failing closed; no plaintext leak assertions PASS. Expected on non-Windows: deterministic non-DPAPI tests PASS and Windows tests skip by `process.platform !== 'win32'`.

- [ ] **Step 8: Commit**

Run: `git add scripts/gate3-dpapi.ps1 scripts/gate3-hosted-secrets.mjs tests/scripts/gate3-hosted-secrets.test.ts tests/scripts/gate3-dpapi.windows.test.ts && git commit -m "feat: protect Gate 3 run secrets with DPAPI"`

---

### Task 4: Pure lifecycle policy and blocker precedence

**Files:**
- Create: `scripts/gate3-hosted-lifecycle.mjs`
- Create: `tests/scripts/gate3-hosted-lifecycle.test.ts`

**Interfaces:**
- Consumes: a serializable inspection result; no filesystem, network, secret, or mutation function.
- Produces: one canonical classification, exact allowed command set, exact next boundary, safe `reasonCode`, and exit-code mapping input.

- [ ] **Step 1: Write the failing lifecycle matrix**

```typescript
const cases = [
  ['fresh bound run', inspection({ actors: 0 }), 'PREFLIGHT_READY', ['inspect', 'provision']],
  ['partial actors', inspection({ actors: 2 }), 'PROVISION_PARTIAL', ['inspect', 'provision', 'cleanup']],
  ['four verified actors', inspection({ actors: 4, provisionVerified: true }), 'PROVISION_VERIFIED', ['inspect', 'scenario', 'cleanup']],
  ['scenario partial', inspection({ scenarioPartial: true }), 'SCENARIO_PARTIAL', ['inspect', 'scenario', 'cleanup']],
  ['cleanup partial', inspection({ cleanupPartial: true }), 'CLEANUP_PARTIAL', ['inspect', 'cleanup']],
  ['archived', inspection({ archived: true }), 'ARCHIVED', ['inspect']]
] as const;

it.each(cases)('%s', (_name, input, classification, allowed) => {
  expect(classifyGate3Lifecycle(input)).toMatchObject({ classification, allowedCommands: allowed });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-lifecycle.test.ts`

Expected: FAIL because lifecycle policy is absent.

- [ ] **Step 3: Implement exact classifications and next-step selectors**

Implement the 12 classifications from the spec. For non-archived runs, precedence is unexplained `AMBIGUOUS`, proven `RELEASE_CHANGED`, proven `RECOVERY_REQUIRED`, then the furthest uniquely proven normal phase. A corrupt state, manifest mismatch, conflicting ownership, untrusted deletion scope, or unavailable authoritative release cannot authorize mutation.

- [ ] **Step 4: Add RED precedence/capability tests**

Cover: ambiguous plus release mismatch -> AMBIGUOUS; release mismatch plus lost credentials -> RELEASE_CHANGED; lost credentials plus exact recovery provenance -> RECOVERY_REQUIRED; recovery permits only recover; state alone cannot advance; scenario step preconditions cannot be skipped; cleanup selects one residual exact artifact; no `force`, retry, wildcard, or mutation function is reachable from lifecycle output.

- [ ] **Step 5: Implement and refactor pure policy tables**

```javascript
export const GATE3_EXIT_CODES = Object.freeze({
  success: 0,
  precondition: 10,
  AMBIGUOUS: 20,
  RELEASE_CHANGED: 21,
  RECOVERY_REQUIRED: 22,
  approvalDeclined: 30,
  confirmedNoMutation: 40,
  uncertainMutation: 41
});
```

- [ ] **Step 6: Run and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-lifecycle.test.ts`

Expected: PASS.

Run: `git add scripts/gate3-hosted-lifecycle.mjs tests/scripts/gate3-hosted-lifecycle.test.ts && git commit -m "feat: add Gate 3 lifecycle policy"`

---

### Task 5: Universal read-only inspector, release proof, and in-memory staging keys

**Files:**
- Modify: `scripts/staging-db-operator.mjs`
- Modify: `scripts/hosted-report-evidence-operator.mjs`
- Create: `scripts/gate3-hosted-inspector.mjs`
- Create: `tests/scripts/gate3-hosted-inspector.test.ts`
- Modify: `tests/scripts/staging-db-operator.test.ts`
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`

**Interfaces:**
- Consumes: Task 1 state, existing manifest validator/writer, deterministic identities, `verifyStagingTarget()`, Supabase admin read capability, and bound Worker fetch capability.
- Produces: sanitized read-only inspection facts, current release SHA, exact/foreign ownership separation, manifest SHA proof, secret-store metadata without decryption, and independent zero verification.

- [ ] **Step 1: Write failing deployed-release tests**

```typescript
it('accepts only the bound staging origin and exact response SHA header', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response('', {
    status: 200,
    headers: { 'x-deployed-git-sha': 'a'.repeat(40) }
  }));
  await expect(resolveDeployedRelease({ workerOrigin: GATE3_WORKER_ORIGIN, fetchImpl }))
    .resolves.toBe('a'.repeat(40));
});

it.each(['', 'abc', 'A'.repeat(40)])('rejects release header %s', async (sha) => {
  await expect(resolveDeployedRelease({ workerOrigin: GATE3_WORKER_ORIGIN, fetchImpl: responseWith(sha) }))
    .rejects.toThrow('release_evidence_invalid');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-inspector.test.ts`

Expected: FAIL because the inspector is absent.

- [ ] **Step 3: Add the minimal Supabase key resolver**

Extend `staging-db-operator.mjs` with `resolveStagingApiKeys({ environment, dependencies })`. It first verifies the linked Frankfurt project, runs the existing sanitized `projects api-keys --project-ref nuhkpqjjyuygiemrxbdp --reveal --output json` path, returns only the publishable and service-role/secret values in memory, and never logs/spools/raw-returns the provider response.

- [ ] **Step 4: Add RED inspector truth and privacy tests**

Test exact states: zero actors; one exact pending role; four exact roles; duplicate role matches; mismatched metadata; manifest actor absent; hosted actor present but manifest stale in each crash window; foreign synthetic account separated; foreign artifacts separated; corrupt state; invalid manifest; manifest SHA mismatch; release changed; release unavailable after fallback binding; DPAPI missing/corrupt metadata without decryption; archived run; all serialized outputs omit emails, tokens, provider bodies, and ciphertext.

- [ ] **Step 5: Implement read-only inspection**

Refactor only reusable read operations from `createSupabaseHostedEvidenceAdapters()` into exported exact-scope helpers; preserve existing callers. The inspector must not receive create/update/delete/upload/RPC-cleanup capabilities. It reads state/manifest bytes, hashes them, derives expected identities, lists exact hosted users and relevant artifacts, reads current Worker SHA, and returns immutable facts plus safe counts.

- [ ] **Step 6: Implement independent hosted-zero verification**

Use a separately injected adapter/factory and fresh queries for the exact manifest actor/report/upload/object/queue identifiers. Verify all current-run counts are zero and the pre-cleanup foreign synthetic identity/artifact set is unchanged; do not reuse `lastInspection` or canonical cleanup result.

- [ ] **Step 7: Run affected tests and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-inspector.test.ts tests/scripts/staging-db-operator.test.ts tests/scripts/hosted-report-evidence-operator.test.ts`

Expected: PASS with sanitized output assertions.

Run: `git add scripts/staging-db-operator.mjs scripts/hosted-report-evidence-operator.mjs scripts/gate3-hosted-inspector.mjs tests/scripts/gate3-hosted-inspector.test.ts tests/scripts/staging-db-operator.test.ts tests/scripts/hosted-report-evidence-operator.test.ts && git commit -m "feat: add Gate 3 hosted inspection"`

---

### Task 6: Fail-closed CLI parsing plus local-only `preflight` and read-only `inspect`

**Files:**
- Create: `scripts/gate3-hosted-cli.mjs`
- Create: `tests/scripts/gate3-hosted-cli.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: strict CLI parser, active/exact run selection, safe output mapper, local-only preflight transaction, read-only inspect command, and exit mapping.

- [ ] **Step 1: Write failing parser tests**

```typescript
it.each([
  ['preflight', ['--new', '--json']],
  ['preflight', ['--run', runId, '--release-sha', 'a'.repeat(40)]],
  ['inspect', ['--run', runId, '--json']],
  ['provision', ['--run', runId]],
  ['scenario', []],
  ['cleanup', ['--json']],
  ['recover', ['--run', runId]]
])('parses %s command-scoped flags', (command, flags) => {
  expect(parseGate3HostedArgs([command, ...flags])).toMatchObject({ command });
});

it.each(['--force','--project-ref','--worker-url','--skip-inspect','--skip-verification','--retry','--cleanup-all','--yes'])(
  'rejects prohibited flag %s',
  (flag) => expect(() => parseGate3HostedArgs(['cleanup', flag])).toThrow('unsupported_argument')
);
```

- [ ] **Step 2: Run parser tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-cli.test.ts -t "parse|flag"`

Expected: FAIL because the CLI is absent.

- [ ] **Step 3: Implement parser and allow-list logging**

Command rules: `preflight` accepts `--run` or `--new` but not both, optional `--release-sha`, optional `--json`; `inspect/provision/scenario/cleanup` accept optional `--run` and `--json`; `recover` requires `--run` and accepts `--json`. Reject duplicates and ignored arguments. JSON output contains only run ID, classification, allowed commands, safe counts, role names, hashes, checkpoints, phases, and safe reason codes.

- [ ] **Step 4: Write failing preflight transaction tests**

Cover: resume active unfinished run by default; `--new` creates one run only; no newest-directory selection; exact `--run` selects an older run; DPAPI probe precedes file creation; authoritative release preferred; fallback exact SHA accepted only on resolver failure; allow-list/absence inspection precedes secret/state/manifest creation; no hosted mutation capability passed; crash before pointer leaves selectable exact run; active pointer switch rejected while current lock valid; rerun is read-only/no-op; secret/store/manifest/state cleanup after a pre-pointer local failure.

- [ ] **Step 5: Implement local-only preflight and read-only inspect**

Preflight order is target/config verification -> release resolution or exact fallback -> DPAPI in-memory round-trip -> deterministic identities -> hosted absence/allow-list read -> reserve run directory -> protect secret payload -> reserve manifest baseline -> reserve state revision 0 -> persist preflight verified revision 1 with hashes -> compare-and-swap active pointer. No hosted create/update/delete capability is accepted by this command.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-cli.test.ts tests/scripts/gate3-hosted-state.test.ts tests/scripts/gate3-hosted-secrets.test.ts tests/scripts/gate3-hosted-inspector.test.ts`

Expected: PASS.

Run: `git add scripts/gate3-hosted-cli.mjs tests/scripts/gate3-hosted-cli.test.ts && git commit -m "feat: add Gate 3 preflight and inspect commands"`

---

### Task 7: Resume-aware A9 provision boundaries using the exact actor set

**Files:**
- Modify: `scripts/hosted-report-evidence-operator.mjs`
- Create: `scripts/gate3-hosted-provision-runner.mjs`
- Create: `tests/scripts/gate3-hosted-provision-runner.test.ts`
- Modify: `tests/scripts/hosted-a9-provisioning.test.ts`
- Modify: `tests/scripts/hosted-a9-runner.test.ts`

**Interfaces:**
- Consumes: lifecycle-authorized provision step, decrypted exact run credentials, existing A9 target/actor/session/MFA primitives, manifest writer, state writer, and fresh inspector.
- Produces: `runProvisionBoundary()` and `runProvisionCommand()`; one deterministic role set; targeted read-back outcome `confirmed`, `confirmed-absent`, or `uncertain`.

- [ ] **Step 1: Write failing zero/partial/four-actor tests**

```typescript
it('creates only the lifecycle-authorized deterministic role after fresh absence proof', async () => {
  const result = await runProvisionBoundary(fixture.authorize('reporter.auth-created'));
  expect(result.status).toBe('confirmed');
  expect(fixture.events).toEqual(['mutate:reporter', 'verify:reporter', 'manifest', 'state']);
  expect(fixture.createdEmails).toEqual([deriveSyntheticIdentity({ runId, role: 'reporter', identitySchemeVersion: 1 }).email]);
});

it('treats four verified exact actors as a mutation-free success', async () => {
  await expect(runProvisionCommand(fixture.fourVerified())).resolves.toMatchObject({ noOp: true });
  expect(fixture.mutations).toHaveLength(0);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-provision-runner.test.ts`

Expected: FAIL because the provision runner is absent.

- [ ] **Step 3: Refactor A9 primitives without changing the compatibility runner**

Expose exact actor absence/provenance/create/session/onboarding/role/MFA/read-back operations from `hosted-report-evidence-operator.mjs`. Keep `runHostedA9Provisioning()` and `pnpm a9:staging:provision` behavior and tests unchanged. New operations accept one role and one exact manifest/state authorization rather than iterating roles internally.

- [ ] **Step 4: Implement provision checkpoint order**

For each role: `auth-created` -> `registration-claimed` -> one `consent-<documentCode>-<documentVersion>` per fresh required document -> `onboarding-complete` -> moderator-only `role-elevated` -> `mfa-enrolled` -> `mfa-verified` -> `actor-verified`. Each durable mutation is followed by targeted read-back; actor creation updates manifest then state; other boundaries verify hosted truth then update state. The high-level command returns to inspector/lifecycle between boundaries while retaining the per-run lock.

- [ ] **Step 5: Add RED transport/crash tests**

For every boundary, inject interruption before mutation, after mutation/before verification, after verification/before manifest, and after manifest/before state. Assert fresh inspection resumes without a second actor or blind replay. Assert transport failure plus absent read-back returns `40`; conflicting/indeterminate read-back returns `41`; release change/ambiguity makes mutation count zero.

- [ ] **Step 6: Add MFA continuity tests**

Cover provider TOTP returned then DPAPI persisted before verification; unverified exact run factor with stored secret resumes verification; exact unverified factor with secret lost is explicitly unenrolled after fresh proof and re-enrolled; verified factor plus missing/corrupt DPAPI becomes `RECOVERY_REQUIRED` only when recovery provenance is exact, otherwise `AMBIGUOUS`; four verified actors never rotate passwords or TOTP.

- [ ] **Step 7: Run A9 suites and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-provision-runner.test.ts tests/scripts/hosted-a9-provisioning.test.ts tests/scripts/hosted-a9-runner.test.ts tests/scripts/hosted-report-evidence-operator.test.ts`

Expected: PASS; compatibility entry point tests remain green.

Run: `git add scripts/hosted-report-evidence-operator.mjs scripts/gate3-hosted-provision-runner.mjs tests/scripts/gate3-hosted-provision-runner.test.ts tests/scripts/hosted-a9-provisioning.test.ts tests/scripts/hosted-a9-runner.test.ts && git commit -m "feat: add resumable Gate 3 provisioning"`

---

### Task 8: Exact-coordinate upload-cleanup capability

**Files:**
- Create: `supabase/migrations/202608200001_gate3_exact_upload_cleanup.sql`
- Modify: `supabase/functions/upload-cleanup/index.ts`
- Modify: `supabase/tests/report_evidence_hardening.pgtap.sql`
- Modify: `supabase/tests/beta-hardening.contract.test.mjs`
- Modify: `tests/contracts/upload-cleanup.contract.test.ts`
- Modify: `scripts/hosted-report-evidence-operator.mjs`
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`

**Interfaces:**
- Consumes: existing service-role upload cleanup queue, storage deletion, completion/failure transitions, and shared-secret HTTP authorization.
- Produces: `claim_exact_upload_cleanup(bigint,text,text,text)` and adapter `invokeExactCleanupWorker({ queueId, bucketId, storagePath })`; the fourth SQL argument is the existing text worker-request ID generated inside the Edge Function, and scheduled empty-body batch behavior remains unchanged.

- [ ] **Step 1: Write failing SQL privilege/coordinate tests**

Add pgTAP assertions that only `service_role` can execute the exact claim; authenticated/anon cannot; wrong queue ID, bucket, path, processed row, future retry row, or already-claimed row returns zero; exact eligible coordinates return one claim and never claim a foreign row.

- [ ] **Step 2: Run database contract tests and verify RED**

Run: `pnpm test:db:contracts`

Expected: FAIL because the migration/function is absent from the contract.

- [ ] **Step 3: Implement the exact claim SQL**

Use a single `UPDATE ... WHERE id = target_queue_id AND bucket_id = target_bucket_id AND storage_path = target_storage_path AND processed_at IS NULL AND next_attempt_at <= now() AND claim lease is available RETURNING` statement. Revoke PUBLIC/anon/authenticated; grant only service_role; set a safe fixed `search_path`; do not accept patterns or arrays.

- [ ] **Step 4: Write failing Edge exact-mode tests**

Test request body exactly `{ "queueId": 17, "bucketId": "report-evidence", "storagePath": "<uuid>/<uuid>.webp" }`; invalid/extra keys -> 400; exact mode skips expiry and global batch claim; claim response must contain exactly the requested coordinates; deletion gets one path; completion gets the same queue ID/request ID; no body still follows existing scheduled batch behavior.

- [ ] **Step 5: Implement exact request mode and adapter**

Keep the 1024-byte cap and constant-time secret check. Parse at most one exact scope, call `claim_exact_upload_cleanup`, reject mismatched claims before storage access, and return the existing sanitized receipt plus `scope: "exact"`. Change `processCleanupQueue()` only by adding an exact manifest/upload/queue overload; do not weaken the legacy scheduled call.

- [ ] **Step 6: Run DB/Edge/operator tests and commit**

Run: `pnpm test:db:contracts && pnpm exec vitest run tests/contracts/upload-cleanup.contract.test.ts tests/scripts/hosted-report-evidence-operator.test.ts`

Expected: PASS.

Run: `git add supabase/migrations/202608200001_gate3_exact_upload_cleanup.sql supabase/functions/upload-cleanup/index.ts supabase/tests/report_evidence_hardening.pgtap.sql supabase/tests/beta-hardening.contract.test.mjs tests/contracts/upload-cleanup.contract.test.ts scripts/hosted-report-evidence-operator.mjs tests/scripts/hosted-report-evidence-operator.test.ts && git commit -m "feat: scope hosted upload cleanup exactly"`

---

### Task 9: Explicit A10 registry and one-boundary scenario runner

**Files:**
- Create: `scripts/gate3-hosted-scenario-runner.mjs`
- Create: `tests/scripts/gate3-hosted-scenario-runner.test.ts`
- Modify: `scripts/hosted-report-evidence-operator.mjs`
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`

**Interfaces:**
- Consumes: lifecycle authorization, exact actor sessions created in memory, existing report-evidence operator, exact cleanup capability, manifest/state writers, and inspector.
- Produces: frozen ordered `A10_STEP_REGISTRY`, `runScenarioBoundary()`, `runScenarioCommand()`, and per-step verification receipts safe for Playwright annotations.

- [ ] **Step 1: Write the failing complete registry test**

```typescript
expect(A10_STEP_REGISTRY.map((step) => step.id)).toEqual([
  'primary-report-created',
  'primary-upload-attached-verified',
  'cross-user-storage-denied',
  'duplicate-reuse-denied',
  'duplicate-upload-created',
  'duplicate-upload-reconciled',
  'assigned-moderator-aal1-denied',
  'assignment-applied',
  'assigned-moderator-read-verified',
  'unassigned-moderator-denied',
  'rejected-upload-created',
  'manual-cleanup-verified',
  'abandoned-upload-allocated',
  'abandoned-object-created',
  'abandoned-upload-backdated',
  'scheduled-cleanup-verified',
  'malformed-request-rejected',
  'invalid-image-rejected',
  'per-file-limit-rejected',
  'aggregate-limit-rejected',
  'chunked-limit-rejected',
  'understated-length-rejected'
]);
```

Each entry declares `scenario`, `kind: mutation|verification`, exact prerequisite IDs, required role capability, mutation method name or `null`, read-back method name, and manifest evidence reducer or `null`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-scenario-runner.test.ts`

Expected: FAIL because the registry/runner is absent.

- [ ] **Step 3: Extract reusable A10 operations**

Move Playwright-independent operations from `tests/e2e/hosted-report-evidence.spec.ts` and the operator façade into injected adapters: exact HTTP report/rejected submission, upload allocation, object upload, upload reconciliation, assignment, exact queue cleanup, backdate, targeted reads, storage authorization reads, and hostile HTTP bodies. Production adapters retain target/manifest/provenance checks.

- [ ] **Step 4: Implement one-boundary execution and ordering**

`runScenarioBoundary()` accepts only the lifecycle-selected registry entry. It rechecks prerequisites, invokes no more than one mutation method, performs targeted read-back, reduces manifest evidence, writes manifest, writes state, and returns. Verification-only entries perform no hosted mutation and update only state after fresh read-only assertions.

- [ ] **Step 5: Add RED outcome and authority tests**

Prove: mutation is unreachable without lifecycle approval; wrong step is not substituted; maximum one mutation method call; manifest always precedes state; a later step is unreachable before persistence; confirmed absence -> `40`; uncertainty -> `41`; next invocation inspects first; scenario fully verified -> read-only/no-op; service-role client is never used for cross-user/actor authorization assertions.

- [ ] **Step 6: Add crash matrix tests for every mutation registry entry**

Use a table over all `kind: mutation` entries and four injected interruption points. Every test asserts fresh inspector reconciliation and zero blind replay. Record event order, mutation count, manifest count, state revision, and selected next step with literal expected arrays.

- [ ] **Step 7: Run focused suites and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-scenario-runner.test.ts tests/scripts/hosted-report-evidence-operator.test.ts`

Expected: PASS.

Run: `git add scripts/gate3-hosted-scenario-runner.mjs scripts/hosted-report-evidence-operator.mjs tests/scripts/gate3-hosted-scenario-runner.test.ts tests/scripts/hosted-report-evidence-operator.test.ts && git commit -m "feat: add resumable Gate 3 scenario steps"`

---

### Task 10: Thin Playwright evidence layer, local/mock flow, and dedicated scenario-8 recovery matrix

**Files:**
- Modify: `tests/e2e/hosted-report-evidence.spec.ts`
- Create: `tests/e2e/gate3-hosted-orchestrator.mock.spec.ts`
- Create: `tests/scripts/gate3-hosted-scenario8-crash.test.ts`
- Modify: `playwright.hosted.config.ts`

**Interfaces:**
- Consumes: Task 9 registry/runner and safe verification receipts.
- Produces: preserved annotations `hosted_scenario_1` through `hosted_scenario_10`, the same hosted evidence semantics through reusable primitives, deterministic local/mock Playwright, and scenario-8-specific restart coverage.

- [ ] **Step 1: Write the failing mock Playwright contract**

Create a fake hosted adapter that starts with four actors and zero artifacts, executes the complete registry, records safe annotations, and asserts each logical scenario number 1–10 appears exactly once. No network target may match `*.supabase.co`, `workers.dev`, or `api.supabase.com`.

- [ ] **Step 2: Run the mock spec and verify RED**

Run: `pnpm exec playwright test tests/e2e/gate3-hosted-orchestrator.mock.spec.ts`

Expected: FAIL because the mock wrapper is absent.

- [ ] **Step 3: Refactor the hosted Playwright file into a reporting wrapper**

Keep the explicit real-run gates, Worker receipt validation, ten numbered annotation types, cross-user/AAL1/AAL2 Storage assertions, hostile multipart limits, cleanup-required annotation on failure, and A11 compatibility test. Replace the monolithic mutation sequence with calls to registry primitives/receipts; do not run hosted work in default Playwright config.

- [ ] **Step 4: Write dedicated scenario-8 crash tests**

Cover literal windows: rejected request committed before discovery; rejected upload known before queue evidence; exact cleanup called before read-back; abandoned allocation before manifest; manifest before object; object before backdate; backdate before scheduled expiry; scheduled expiry/queue/object changes between inspection and persistence; queue evidence before state; every transport-uncertain path stops at `41` and later inspection reconciles without replay.

- [ ] **Step 5: Run local/mock and hosted-skip verification**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-scenario8-crash.test.ts && pnpm exec playwright test tests/e2e/gate3-hosted-orchestrator.mock.spec.ts && pnpm exec playwright test --config playwright.hosted.config.ts tests/e2e/hosted-report-evidence.spec.ts`

Expected: Vitest and mock Playwright PASS; hosted config reports the real-hosted tests skipped because approval inputs are absent, with zero hosted mutation.

- [ ] **Step 6: Commit**

Run: `git add tests/e2e/hosted-report-evidence.spec.ts tests/e2e/gate3-hosted-orchestrator.mock.spec.ts tests/scripts/gate3-hosted-scenario8-crash.test.ts playwright.hosted.config.ts && git commit -m "test: share Gate 3 scenario primitives"`

---

### Task 11: Canonical exact-scope cleanup, approval invalidation, and archive completion

**Files:**
- Modify: `scripts/hosted-report-evidence-operator.mjs`
- Create: `scripts/gate3-hosted-cleanup-runner.mjs`
- Create: `tests/scripts/gate3-hosted-cleanup-runner.test.ts`
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`
- Modify: `tests/scripts/gate3-hosted-cli.test.ts`

**Interfaces:**
- Consumes: fresh inspection, lifecycle exact residual step, exact manifest hash, target/release binding, foreign preservation snapshot, invocation-scoped typed run ID, exact cleanup adapters, independent zero verifier, DPAPI destruction, state/archive functions.
- Produces: `prepareCleanupApproval()`, `validateCleanupApproval()`, `runCleanupBoundary()`, and resumable canonical cleanup/finalization.

- [ ] **Step 1: Write failing pre-prompt scope tests**

Assert no prompt callback occurs unless lock, run selection, project, Worker origin, release SHA, manifest path, manifest SHA, exact deletion IDs, and foreign preservation set are all freshly proven. Corrupt/mismatched/ambiguous evidence produces zero deletions and zero prompts.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-cleanup-runner.test.ts`

Expected: FAIL because cleanup runner is absent.

- [ ] **Step 3: Implement typed approval and invalidation**

The only accepted input is the exact current `runId`. `y`, `yes`, empty input, prior state, environment approval, and CLI flags return exit `30`. Immediately before first deletion, re-inspect and compare project/origin/release, manifest path/SHA, exact residual set, and foreign snapshot byte-for-byte; any change invalidates approval and performs no deletion.

- [ ] **Step 4: Add RED exact residual/deletion-order tests**

Use manifest IDs only. Select one boundary at a time: delete exact report+owner and verify report/upload absence plus exact queue effect; reject exact unattached upload and verify; invoke exact cleanup worker and verify object absent/queue processed; delete exact processed queue row and verify; delete one exact actor after provenance check and verify absent. Never use patterns, newest files, actor-email prefixes, wildcard Storage paths, or global cleanup fallback.

- [ ] **Step 5: Implement resumable boundary loop**

After every deletion: targeted absence read -> manifest evidence update -> manifest write -> state revision. Re-inspect and ask lifecycle again before the next deletion. Partial cleanup resumes the exact residual set and treats already-absent verified IDs as reconciled, not as permission to widen scope.

- [ ] **Step 6: Add RED completion-order tests**

Prove canonical zero -> independent fresh zero -> unchanged foreign set -> optional ciphertext SHA evidence -> DPAPI unlink/read-back absent -> state secret status `destroyed-after-cleanup` -> archive pending/rename/complete -> pointer clear. Any failure preserves the live run and never destroys secrets early.

- [ ] **Step 7: Run cleanup suites and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-cleanup-runner.test.ts tests/scripts/gate3-hosted-cli.test.ts tests/scripts/hosted-report-evidence-operator.test.ts tests/scripts/gate3-hosted-state.test.ts`

Expected: PASS.

Run: `git add scripts/hosted-report-evidence-operator.mjs scripts/gate3-hosted-cleanup-runner.mjs tests/scripts/gate3-hosted-cleanup-runner.test.ts tests/scripts/hosted-report-evidence-operator.test.ts tests/scripts/gate3-hosted-cli.test.ts && git commit -m "feat: add resumable Gate 3 cleanup"`

---

### Task 12: Explicit recovery wrapper over proven abandoned-run primitives

**Files:**
- Modify: `scripts/hosted-abandoned-run-recovery.mjs`
- Modify: `scripts/hosted-abandoned-run-recovery-runner.mjs`
- Create: `scripts/gate3-hosted-recovery-runner.mjs`
- Create: `tests/scripts/gate3-hosted-recovery-runner.test.ts`
- Modify: `tests/scripts/hosted-abandoned-run-recovery.test.ts`
- Modify: `tests/scripts/hosted-abandoned-run-recovery-runner.test.ts`
- Modify: `tests/scripts/gate3-hosted-cli.test.ts`

**Interfaces:**
- Consumes: lifecycle classification exactly `RECOVERY_REQUIRED`, fresh recovery dry-run, manifest checkpoint/hash, exact run approval, existing provenance/adapter functions, independent zero verifier, non-secret archive finalization.
- Produces: explicit `recover --run` flow and one-actor deletion boundary; normal cleanup never imports/calls it.

- [ ] **Step 1: Write failing recovery eligibility tests**

```typescript
it.each(['PREFLIGHT_READY','PROVISION_PARTIAL','RELEASE_CHANGED','AMBIGUOUS','CLEANUP_REQUIRED'])(
  'performs no recovery mutation under %s',
  async (classification) => {
    await expect(runRecoveryBoundary(fixture.withClassification(classification)))
      .rejects.toThrow('recovery_not_authorized');
    expect(fixture.deleteActor).not.toHaveBeenCalled();
  }
);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-recovery-runner.test.ts`

Expected: FAIL because the wrapper is absent.

- [ ] **Step 3: Extract one-actor proven recovery deletion**

Refactor `executeAbandonedRecoveryCleanup()` so the existing compatibility runner can still iterate all actors, while the new export validates the same manifest/provenance/checkpoint and deletes/verifies only one exact manifest actor. Preserve existing sanitized errors and tests.

- [ ] **Step 4: Implement recovery dry-run/checkpoint/approval flow**

Fresh inspect -> require RECOVERY_REQUIRED -> `runAbandonedRecoveryDryRun` -> persist non-secret checkpoint with manifest hash/counts -> prove exact scope -> prompt exact runId -> fresh recheck and invalidate on change -> one exact actor delete/read-back -> manifest/state -> repeat inspection. No `--yes`, cleanup fallback, or wildcard capability exists.

- [ ] **Step 5: Add resume, preservation, and completion tests**

Cover one/two/three actors already absent after prior verified deletes; wrong/mutated manifest; foreign artifact/account; current-run reports/uploads/objects that make proven recovery impossible; changed release; declined approval; independent zero failure; archive contains no live DPAPI file; foreign set identical before/after.

- [ ] **Step 6: Run recovery suites and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-recovery-runner.test.ts tests/scripts/hosted-abandoned-run-recovery.test.ts tests/scripts/hosted-abandoned-run-recovery-runner.test.ts tests/scripts/hosted-abandoned-run-recovery-cli.test.ts tests/scripts/gate3-hosted-cli.test.ts`

Expected: PASS; `pnpm gate3:recovery` compatibility remains intact.

Run: `git add scripts/hosted-abandoned-run-recovery.mjs scripts/hosted-abandoned-run-recovery-runner.mjs scripts/gate3-hosted-recovery-runner.mjs tests/scripts/gate3-hosted-recovery-runner.test.ts tests/scripts/hosted-abandoned-run-recovery.test.ts tests/scripts/hosted-abandoned-run-recovery-runner.test.ts tests/scripts/gate3-hosted-cli.test.ts && git commit -m "feat: add explicit Gate 3 recovery"`

---

### Task 13: Wire all CLI commands, compatibility contracts, and operator documentation

**Files:**
- Modify: `scripts/gate3-hosted-cli.mjs`
- Modify: `tests/scripts/gate3-hosted-cli.test.ts`
- Modify: `package.json`
- Modify: `docs/STAGING-CREDENTIALS.md`
- Create: `docs/GATE3-HOSTED-ORCHESTRATOR.md`

**Interfaces:**
- Consumes: all prior task runners and exact exit codes.
- Produces: `pnpm gate3:hosted <command>` for preflight/provision/scenario/inspect/cleanup/recover, PowerShell 5.1 operator guidance without secrets, and compatibility assertions.

- [ ] **Step 1: Write failing end-to-end CLI composition tests**

For each command assert exact capability construction: inspect has no mutation/secret decryptor; preflight has no hosted mutation; provision gets only A9 boundary methods; scenario gets only selected A10 boundary; cleanup gets exact deletion methods only after proof/approval; recovery gets abandoned recovery only under RECOVERY_REQUIRED. Assert exit codes 0/10/20/21/22/30/40/41 and sanitized human/JSON output.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-cli.test.ts`

Expected: FAIL for unwired provision/scenario/cleanup/recover commands.

- [ ] **Step 3: Wire command loops and package entry point**

Add only `"gate3:hosted": "node scripts/gate3-hosted-cli.mjs"`. Keep the existing `a9:staging:provision` and `gate3:recovery` values byte-for-byte unchanged. Stateful high-level commands hold the run lock, repeat inspect -> lifecycle -> one boundary -> verify/persist, and stop immediately on any non-confirmed result.

- [ ] **Step 4: Add RED PowerShell 5.1 behavior tests**

Inject native runner outcomes for command-not-found, nonzero exit, harmless stderr with zero exit, long-running live stdout, and UTF-8 without BOM writes. Assert `$LASTEXITCODE` is read only after a native process starts and no provider output is echoed.

- [ ] **Step 5: Document exact safe operator flow**

Document storage layout, commands, allowed flags, classifications, exit codes, exact run-ID approval, DPAPI current-user/machine continuity, required on-demand privileged inputs without values, crash recovery, no automatic retry after 41, no cleanup/recovery fallback, and the explicit separation between local CI and real hosted acceptance.

- [ ] **Step 6: Run CLI/compatibility/document checks and commit**

Run: `pnpm exec vitest run tests/scripts/gate3-hosted-cli.test.ts tests/scripts/hosted-a9-runner.test.ts tests/scripts/hosted-abandoned-run-recovery-cli.test.ts`

Expected: PASS.

Run: `pnpm gate3:hosted inspect --run invalid-run`

Expected: exit `10` with a fixed safe precondition message and no secret/provider output.

Run: `git add scripts/gate3-hosted-cli.mjs tests/scripts/gate3-hosted-cli.test.ts package.json docs/STAGING-CREDENTIALS.md docs/GATE3-HOSTED-ORCHESTRATOR.md && git commit -m "feat: wire Gate 3 hosted lifecycle CLI"`

---

### Task 14: Repository verification and independent R2 reviews

**Files:**
- Modify only files required to repair review findings.

**Interfaces:**
- Consumes: complete branch diff from the design commit through Task 13.
- Produces: deterministic local evidence, whole-branch engineering verdict, adversarial security verdict, and scoped re-review evidence after repairs.

- [ ] **Step 1: Run focused orchestration suites**

Run:

```powershell
pnpm exec vitest run tests/scripts/gate3-hosted-state.test.ts tests/scripts/gate3-hosted-secrets.test.ts tests/scripts/gate3-dpapi.windows.test.ts tests/scripts/gate3-hosted-lifecycle.test.ts tests/scripts/gate3-hosted-inspector.test.ts tests/scripts/gate3-hosted-cli.test.ts tests/scripts/gate3-hosted-provision-runner.test.ts tests/scripts/gate3-hosted-scenario-runner.test.ts tests/scripts/gate3-hosted-scenario8-crash.test.ts tests/scripts/gate3-hosted-cleanup-runner.test.ts tests/scripts/gate3-hosted-recovery-runner.test.ts
```

Expected: all focused files PASS; Windows DPAPI tests execute on Windows.

- [ ] **Step 2: Run affected compatibility, database, and Playwright suites**

Run:

```powershell
pnpm test:db:contracts
pnpm exec vitest run tests/scripts/hosted-a9-provisioning.test.ts tests/scripts/hosted-a9-runner.test.ts tests/scripts/hosted-abandoned-run-recovery.test.ts tests/scripts/hosted-abandoned-run-recovery-runner.test.ts tests/scripts/hosted-abandoned-run-recovery-cli.test.ts tests/scripts/hosted-report-evidence-operator.test.ts tests/contracts/upload-cleanup.contract.test.ts
pnpm exec playwright test tests/e2e/gate3-hosted-orchestrator.mock.spec.ts
pnpm exec playwright test --config playwright.hosted.config.ts tests/e2e/hosted-report-evidence.spec.ts
```

Expected: local/contract/mock suites PASS; real-hosted tests skip with no hosted mutation.

- [ ] **Step 3: Run full repository verification**

Run:

```powershell
pnpm test
pnpm test:e2e
pnpm db:lint
pnpm db:test
```

Expected: commands exit `0`; if local Supabase prerequisites are unavailable, record the exact unavailable command as missing evidence rather than claiming PASS, while `pnpm test` and mutation-free suites must still pass.

- [ ] **Step 4: Dispatch independent whole-branch engineering review**

Use the strongest appropriate reviewer at xtra-high reasoning. Provide the spec, plan, merge base, head, focused evidence, and require requirement-by-requirement review of correctness, crash windows, one-boundary authority, compatibility, and Windows behavior.

- [ ] **Step 5: Dispatch independent adversarial security review**

Use a separate strong reviewer. Require attempts to find secret leakage, capability escalation, wrong-target mutation, manifest/state confusion, replay after uncertainty, deletion-scope widening, approval reuse, foreign artifact deletion, corrupt-state authorization, DPAPI plaintext persistence, CI hosted mutation, and release-check bypass.

- [ ] **Step 6: Repair valid findings and perform scoped re-reviews**

Every behavioral repair begins with a failing regression test. Re-run affected focused tests, then send only the finding, repair diff, and evidence to the appropriate independent reviewer. Do not waive an R2 finding without deterministic counter-evidence.

- [ ] **Step 7: Audit final diff and status**

Run:

```powershell
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
git status --short
```

Verify no `.codegraph` database, `.atl` registry, `.superpowers` ledger, generated build output, plaintext fixture, ciphertext, secret-shaped value, debug logging, or unrelated refactor is tracked.

---

## Owner-Gated Phase 5 Hosted Acceptance (Not Authorized in This Plan Execution)

The design is not fully proven until one new real staging run completes. This is an R3 external/stateful operation and is deliberately excluded from automatic SDD execution in this session.

After repository implementation, reviews, CI, deployment of the exact reviewed Worker/database changes, current backup/recovery evidence, and explicit owner approval, execute:

```powershell
pnpm gate3:hosted preflight --new
pnpm gate3:hosted inspect
pnpm gate3:hosted provision
pnpm gate3:hosted inspect
pnpm gate3:hosted scenario
pnpm gate3:hosted inspect
pnpm gate3:hosted cleanup
pnpm gate3:hosted inspect --run <exact-run-id>
```

At the cleanup prompt, type the exact run ID only after the command displays proven exact scope. Acceptance evidence must show canonical zero, independent zero, unchanged foreign artifacts/accounts, destroyed DPAPI store, archived non-secret evidence, and cleared active pointer. Do not push, merge, deploy, publish, or run this hosted lifecycle without separate explicit approval.

## Spec Coverage Matrix

| Design section | Implementation task(s) and evidence |
| --- | --- |
| 1. Purpose | Tasks 6 and 13 expose the persistent staging-only operator flow. |
| 2. Process boundary | Tasks 1–13 implement repository phases 1–4; the owner-gated section isolates the real hosted run. |
| 3. Goals | Tasks 1–13 cover persistence, simplification, exact targeting, resumability, scoped cleanup, and CI testability. |
| 4. Non-goals | Global Constraints prohibit production generalization, secret management expansion, hosted CI mutation, and compatibility removal. |
| 5. Architectural boundaries | Tasks 1, 3, 4, 5, 7, 9, 11, and 12 separate state, secrets, inspection, policy, and mutation capabilities. |
| 6. Module boundaries | The Interface Map and Tasks 1–13 create or wire every named module from sections 6.1–6.11. |
| 7. Persistent run layout | Tasks 1 and 2 implement `active/<runId>`, root pointer, per-run lock, and archive. |
| 8. Persistent state model | Task 1 implements schema version, revisions, bindings, phases, checkpoints, safe inspection cache, and archive metadata without exact artifact IDs. |
| 9. Atomic state persistence | Task 1 tests same-directory write, flush, rename, permission, read-back, and revision comparison. |
| 10. Manifest contract | Tasks 1, 5, 7, 9, 11, and 12 preserve the manifest as exact hosted evidence and verify its SHA before authority decisions. |
| 11. Active-run model | Tasks 1, 2, and 6 implement explicit selection and pointer compare-and-swap without newest-directory heuristics. |
| 12. Per-run concurrency and locking | Task 2 implements PID-backed exact-run locks; Tasks 6, 7, 9, 11, and 12 hold them around stateful command loops. |
| 13. Version 1 target binding | Tasks 1, 5, and 6 hard-code and reverify the approved Supabase project and Worker origin. |
| 14. Release binding | Tasks 5 and 6 resolve the Worker header, constrain fallback, persist binding, and block mutation without fresh authoritative equality. |
| 15. Preflight | Task 6 implements the ordered local/control-plane transaction and absence/allow-list checks with no hosted mutation capability. |
| 16. Synthetic identities | Task 3 implements versioned SHA-256-derived role identities and exact deterministic tests. |
| 17. DPAPI secret-store lifecycle | Tasks 3, 6, 7, and 11 implement CurrentUser DPAPI, probe, atomic ciphertext lifecycle, provider TOTP continuity, and post-zero destruction. |
| 18. Inspector contract | Task 5 implements universal fresh read-only truth, exact/foreign separation, safe facts, and independent zero. |
| 19. Canonical lifecycle classifications | Task 4 implements all classifications, precedence, allowed commands, and exact next-step selectors as pure policy. |
| 20. Provisioning model | Task 7 implements zero/partial/four-actor behavior, exact actor set, no rotation, MFA continuity, and ambiguity handling. |
| 21. A10 reusable scenario engine | Tasks 9 and 10 create the complete stable registry, reusable primitives, and thin Playwright evidence layer. |
| 22. Scenario runner contract | Task 9 tests fresh authorization, one exact step, read-back, manifest/state order, and return to orchestrator. |
| 23. One-mutation-boundary rule | Tasks 7, 9, 11, and 12 restrict each runner capability and prove no second mutation before persistence. |
| 24. Transport and mutation outcomes | Tasks 4, 7, 9, 11, 12, and 13 implement confirmed, confirmed-absent (`40`), and uncertain (`41`) behavior without replay. |
| 25. Mandatory mutation ordering | Tasks 7, 9, 11, and 12 assert `mutation -> verification -> manifest -> state` for every represented mutation. |
| 26. Crash and restart semantics | Tasks 7 and 9 table-test all four windows; Task 10 adds dedicated scenario-8 windows; Tasks 11 and 12 test destructive resume. |
| 27. Cleanup entry conditions | Task 11 requires fresh scenario/provision/lifecycle/scope proof before prompt or deletion. |
| 28. Cleanup approval model | Task 11 accepts only the exact invocation-scoped run ID and invalidates approval on any scope/binding change. |
| 29. Cleanup resume semantics | Task 11 selects one exact residual artifact, reconciles verified absence, and never widens scope. |
| 30. Cleanup completion | Tasks 2, 5, and 11 implement canonical zero, independent zero, foreign preservation, secret destruction, archive, and pointer clear in order. |
| 31. Recovery model | Task 12 wraps proven abandoned-run primitives only under `RECOVERY_REQUIRED`, with separate dry-run/checkpoint/approval and no normal-cleanup fallback. |
| 32. CLI flags | Tasks 6 and 13 implement only command-scoped `--run`, `--new`, `--release-sha`, and `--json`, rejecting duplicates and prohibited controls. |
| 33. Exit codes | Tasks 4, 6, and 13 define and composition-test codes `0`, `10`, `20`, `21`, `22`, `30`, `40`, and `41`. |
| 34. Capability-based privilege model | Tasks 5–13 construct read-only and exact-mutation capabilities per command and runner step. |
| 35. Logging and secret handling | Tasks 3, 5, 6, and 13 test allow-listed human/JSON output and sanitized errors with no secret/provider/ciphertext exposure. |
| 36. Inspection versus repair | Tasks 4, 5, 7, 9, 11, and 12 keep inspection read-only and make every repair an explicit lifecycle-authorized boundary. |
| 37. Testing strategy | Tasks 1–13 add unit, runner, Windows DPAPI, inspector, contract, database, crash, and local/mock Playwright tests; Task 14 aggregates them. |
| 38. No real hosted mutation in CI | Tasks 6–14 inject fake adapters, verify real-hosted skips, and never supply approval/secrets to normal CI. |
| 39. Implementation phases | Tasks 1–6 are Phase 1, Task 7 is Phase 2, Tasks 8–10 are Phase 3, Tasks 11–13 are Phase 4, and the owner-gated section is Phase 5. |
| 40. Backward compatibility | Tasks 7, 10, 12, and 13 preserve A9, A10/A11 annotations, A11 semantics, and old recovery entry points until real acceptance. |
| 41. Migration principle | Tasks 7 and 12 reuse A9/recovery primitives; Tasks 9 and 10 refactor only A10 resumability; all tasks prohibit unrelated refactors. |
| 42. Security invariants | Global Constraints plus Tasks 1–14 cover fixed target/release, fail-closed authorization, exact scope, foreign preservation, secret minimization, and non-hosted CI. |
| 43. Windows PowerShell 5.1 compatibility | Tasks 3 and 13 test DPAPI piping, native exit behavior, harmless stderr, long output, and UTF-8 without BOM. |
| 44. Success criteria | Tasks 1–14 prove repository-safe criteria; the owner-gated Phase 5 is explicitly required before claiming real hosted success. |
| 45. Implementation-plan handoff | Existing Implementation and Risk Map plus Tasks 1–14 name reusable symbols, exact files, stable A10 checkpoints, recovery surfaces, and tests. |

## Plan Self-Review Checklist

- [x] Every design section 1–45 maps to a task or the owner-gated Phase 5 acceptance.
- [x] Every new or changed interface has one canonical name and matching producer/consumer tasks.
- [x] Every behavior task includes a test that fails before implementation and a command that observes the failure.
- [x] Manifest writes precede state writes after every verified represented hosted mutation.
- [x] No task changes product behavior outside Gate 3 or removes compatibility entry points.
- [x] No task permits hosted mutation from normal CI.
- [x] No task introduces force, retry, wildcard, skip-verification, project/Worker override, or blanket approval behavior.
- [x] Shared-file changes are sequential: state 1->2, operator 5->7->8->9->11, CLI 6->11->12->13.
- [x] The R3 hosted acceptance remains explicitly outside automatic execution.

Self-review repaired three concrete inconsistencies before execution: the deterministic identity test vector now matches the specified SHA-256 input, the exact cleanup RPC uses the existing text worker-request-ID type rather than UUID, and `package.json` ownership is deferred from Task 6 to the single Task 13 wiring change. The review also confirmed that the current A10 global cleanup helper is not granted to the new runner before Task 8 provides an exact-coordinate capability.
