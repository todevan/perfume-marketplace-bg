# Gate 0 — Baseline and Reproducibility

## Objective
Establish the exact current repository state, test commands, and reproduction coverage before modifying behavior.

## Scope
Read-only inspection and test execution only.

The baseline is the protected uncommitted checkout exactly as it existed at the
start of this gate. Gate 0 does not treat the current uncommitted auth refactor,
tests, README changes, or `docs/testing/` files as changes made by this gate.

## Required inspection
- `src/hooks.server.ts`
- `src/lib/server/auth/guards.ts`
- affected auth routes
- `tests/server/auth-refactor-contract.test.ts`
- `package.json`
- current auth/lifecycle tests

## Checklist
- [x] Record branch and commit SHA.
- [x] Record whether `.git` exists.
- [x] Record dependency/install state.
- [x] Record canonical unit/server, check, build, DB lint/test, and E2E commands.
- [x] Search for existing onboarding/login/recovery/MFA tests.
- [x] Run existing focused auth tests unchanged.
- [x] Run broader verification where environment permits.
- [x] Record every command as PASS / FAIL / NOT RUN with reason.

## Pass condition
No behavior changes; current state and verification limitations are documented well enough that later results can be compared to a known baseline.

## Execution Record
**Status:** COMPLETE

**Branch / SHA:** `main` / `fb3e644615c6bbe4895142d6fc4fabbce00e853f`

### Repository and dependency state

- `.git` is present. `git rev-parse --git-dir` and
  `git rev-parse --git-common-dir` both returned `.git`; this checkout is the
  primary worktree, not a linked worktree.
- `origin/main` points to the same recorded SHA. Two other linked worktrees
  exist and were not touched.
- Initial tracked diff: 66 files, 1,526 insertions, 901 deletions. The complete
  355-line tracked/untracked path inventory and reproducible checksums for the
  status stream and 4,088-line binary tracked diff are preserved in
  [`gate-0-working-tree-manifest.md`](./gate-0-working-tree-manifest.md). This
  includes protected auth selective-loading work, auth regression/contract
  tests, README changes, and `docs/testing/`.
- `node_modules` is present. Runtime: Node `v22.23.2`; pnpm `11.9.0`, matching
  `packageManager: pnpm@11.9.0` and the repository's Node 22 engine.
- `package.json` scripts are unchanged from `HEAD`; its current uncommitted diff
  only adds `@remix-run/form-data-parser`.
- The GitHub Issues frontier was empty when inspected. No issue or other remote
  resource was created or changed.

### Canonical commands from `package.json`

| Purpose | Command | Current script |
| --- | --- | --- |
| Unit/server tests | `pnpm test:unit` | `vitest run` |
| Combined repository verification | `pnpm test` | catalog validation, Vitest, Svelte check, build |
| Svelte/type check | `pnpm check` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` |
| Production build | `pnpm build` | `vite build` |
| DB contract tests | `pnpm test:db:contracts` | Node contract tests under `supabase/tests/` |
| DB lint | `pnpm db:lint` | local Supabase lint at warning level |
| DB tests | `pnpm db:test` | `supabase test db` |
| E2E | `pnpm test:e2e` | build, then Playwright |

The six audited Gate 0 commands remain exactly the commands listed below; no
script-name substitution was needed.

### Auth test inventory and lifecycle reproducibility

| File/evidence | What it currently proves | Lifecycle limitation |
| --- | --- | --- |
| `tests/server/auth-refactor-contract.test.ts` | Hook response failures, guard redirects, and selective auth call counts | Its authenticated `/onboarding` case expects profile and beta access not to load, so it codifies the audited lifecycle bug instead of executing the onboarding loader/action. |
| `tests/server/auth-guards-regression.test.ts` | Route classification, guard outcomes, eager context projection/failures | Does not execute a route consumer with `handle`. |
| `tests/server/auth-runtime.test.ts` | Guard/runtime/auth projection/Turnstile units | Does not execute onboarding, authenticated login, password-update, or MFA page-server lifecycles. |
| `tests/server/admin-moderation.test.ts` | Direct admin request-boundary AAL2/MFA redirect checks and a legacy auth-callback redirect ending at onboarding | Does not execute `handle` with the `/auth/mfa` or onboarding page-server consumers; its callback path is legacy invitation coverage, not the open-registration lifecycle. |
| `tests/server/login-backend-attestation.test.ts` | Direct login loader staging attestation and direct registration actions | Does not cover an already-active authenticated user visiting `/login`. |
| `tests/components/auth-shell.test.ts` | Header presentation for manually supplied auth states | Does not prove that public-route hook/layout data supplies active membership. |
| `tests/e2e/real-beta.spec.ts` | Hosted login and moderator MFA when explicitly enabled | Both real hosted tests are skipped without `E2E_REAL_RUN=true`; no onboarding or password-recovery lifecycle is present. |

Search found no test importing the page-server modules for `/onboarding`,
`/auth/update-password`, or `/auth/mfa`. Therefore the current executable tests
do **not** reproduce the four audited auth lifecycles end-to-end.

Static reconciliation of the protected working tree explains why:

- `src/hooks.server.ts` derives enrichment only from `RouteAccessPolicy`.
- `/onboarding` and `/auth/update-password` are `authenticated`, so the hook
  loads only the user even though their consumers require profile/beta state.
- `/login` is `public`, so an authenticated active user reaches its loader with
  no beta state and is redirected to onboarding.
- `/auth/mfa` is `staff-aal1`, so current AAL is omitted even though its loader
  must recognize an already-AAL2 staff member.
- Public/legal route layout data can give `Header.svelte` an authenticated user
  without beta state, which the header interprets as needing onboarding.

These are the planned Gate 1 findings. Gate 0 did not modify them or add the
missing lifecycle tests.

### Files changed by Gate 0

- `docs/superpowers/plans/gate-0-baseline.md` — filled the execution record.
- `docs/superpowers/plans/gate-0-working-tree-manifest.md` — preserved the
  complete initial dirty-path inventory and checksums requested by independent
  review. It contains paths and diff metadata only, not file contents or secrets.

### Tests added or modified by Gate 0

- None.

### Commands run

| Command/evidence | Actual result | Status |
| --- | --- | --- |
| `git status --short` | Protected tracked and untracked baseline captured. | PASS |
| `git status --short --untracked-files=all` | 355 exact path/status lines preserved in `gate-0-working-tree-manifest.md`; status-stream checksum `2c56652000a0c1bb0bfc42271a8a986f44b1f40e`. | PASS |
| `git diff` | Current tracked changes inspected; combined terminal rendering was truncated, so Gate 0 auth files were then inspected individually. | PASS |
| `git diff --stat` | 66 files, 1,526 insertions, 901 deletions. | PASS |
| `git diff --binary --full-index` checksum/size | 4,088 lines / 197,773 characters; stream checksum `2995707581938e275325779f17316f7f2f7159ce`, preserved with the path inventory. | PASS |
| `git branch --show-current`; `git rev-parse HEAD`; Git/worktree inspection | `main`, recorded SHA, `.git` present, primary worktree confirmed. | PASS |
| Dependency/version inspection | `node_modules` present; Node `v22.23.2`; pnpm `11.9.0`. | PASS |
| Auth inventory searches with `rg` | Current hook/guard/component/direct-login coverage found; no onboarding/update-password/MFA page-server lifecycle imports found. | PASS |
| `pnpm exec vitest run tests/server/auth-refactor-contract.test.ts tests/server/auth-guards-regression.test.ts tests/server/auth-runtime.test.ts tests/server/login-backend-attestation.test.ts tests/components/auth-shell.test.ts` | Timed out after 124 seconds with no test output (exit 124). Orphaned processes from this command were identified by exact command line and stopped. | FAIL |
| `pnpm exec vitest run tests/server/auth-refactor-contract.test.ts tests/server/auth-guards-regression.test.ts tests/server/auth-runtime.test.ts tests/server/login-backend-attestation.test.ts tests/components/auth-shell.test.ts --maxWorkers=1` | Did not complete or emit results after more than 60 seconds; terminated as inconclusive. | FAIL |
| `pnpm exec vitest run tests/server/auth-refactor-contract.test.ts --reporter=verbose --maxWorkers=1` | 1 file passed; 11/11 tests passed. | PASS |
| `pnpm exec vitest run tests/server/auth-guards-regression.test.ts --reporter=verbose --maxWorkers=1` | 1 file passed; 11/11 tests passed. | PASS |
| `pnpm exec vitest run tests/server/auth-runtime.test.ts --reporter=verbose --maxWorkers=1` | 1 file passed; 18/18 tests passed. | PASS |
| `pnpm exec vitest run tests/server/admin-moderation.test.ts --reporter=verbose --maxWorkers=1` | 1 file passed; 20/20 tests passed, including the direct AAL2/MFA request boundary and legacy auth-callback onboarding redirect. | PASS |
| `pnpm exec vitest run tests/server/login-backend-attestation.test.ts --reporter=verbose --maxWorkers=1` | 1 file passed; 7/7 tests passed. | PASS |
| `pnpm exec vitest run tests/components/auth-shell.test.ts --reporter=verbose --maxWorkers=1` | Timed out after 64 seconds without results (exit 124). The full repository run later completed this test population but still failed elsewhere. | FAIL |
| `pnpm test` | Catalog validation passed. Vitest: 35/37 files passed, 306/308 tests passed. Failures: deployment-hardening expected the staging publishable key to be a string but current `wrangler.jsonc` provides an object; auth-refactor profile-failure test exceeded its 5-second timeout under the full parallel run. The script stopped before its check/build stages. | FAIL |
| `pnpm check` | Exit 0; Svelte check found 0 errors and 0 warnings. | PASS |
| `pnpm build` | Exit 0; production SSR/client build completed with Cloudflare adapter. | PASS |
| `pnpm db:lint` | Exit 1; local Supabase CLI could not connect to Postgres (`LegacyDbConnectError`). | FAIL |
| `pnpm db:test` | Exit 1; local Supabase CLI could not connect to Postgres (`LegacyDbConnectError`). | FAIL |
| `pnpm test:e2e` | Exit 0; build passed, Playwright reported 13 passed and 5 intentionally skipped. The real hosted marketplace/MFA checks were among the skips. | PASS |
| Independent Superpowers code review and scoped re-review | Initial review found two Important evidence gaps. After the manifest/checksum and admin-moderation remediation, scoped re-review marked both findings ADDRESSED, found no new breakage, returned APPROVED, and confirmed the Gate 0 decision is justified. | PASS |

### Current verification limitations

- The local Supabase/Postgres service is unavailable, so DB lint and pgTAP
  evidence is not current.
- `pnpm test` is not green due to two concrete failures listed above.
- Focused multi-file/component Vitest invocations have non-completion behavior;
  the four primary auth server files pass individually (47/47 tests total), and
  the additionally inventoried admin-moderation suite passes 20/20.
- No current test crosses the hook plus route-consumer boundary for the audited
  onboarding, active-login, password-recovery, or already-AAL2 MFA lifecycles.
- Real hosted lifecycle tests were not run and are not counted as green.

### Unexpected findings

- The protected selective-loading contract and `docs/testing/` explicitly say
  authenticated `/onboarding` should not load profile/beta state. This conflicts
  with the approved beta-readiness design for Gate 1, but it does not conflict
  with Gate 0's read-only baseline objective. Nothing was overwritten.
- The full test suite also exposes a current staging-config contract mismatch in
  `wrangler.jsonc` and a parallel-run timeout in the auth hook test. Neither was
  remediated because Gate 0 forbids behavior/configuration changes.
- Independent review initially found that the exact dirty-path baseline and
  `admin-moderation.test.ts` inventory were incomplete. Both evidence gaps were
  remediated inside Gate 0 without changing application behavior; scoped
  re-review approved both fixes with no new Critical/Important finding.

### Acceptance criteria

| Required condition | Verification command or evidence source | Actual result | Decision |
| --- | --- | --- | --- |
| Current SHA/state recorded | Git status/diff/stat, branch/SHA/worktree commands, complete manifest and stream checksums | Exact SHA, branch, worktree form, all 355 tracked/untracked paths, tracked diff size, and reproducible status/diff checksums recorded. | PASS |
| Canonical test commands known | Current `package.json` and its diff against `HEAD` | Current unit/check/build/DB/E2E scripts recorded; script definitions are unchanged. | PASS |
| Auth test inventory known | `rg` inventory plus inspection of primary source/test files and focused admin-moderation execution | Existing coverage, including admin AAL2/MFA and legacy onboarding callback tests, and the missing lifecycle seams are recorded explicitly. | PASS |
| Current verification limitations recorded | Fresh focused and six-command canonical execution | Every required command has a concrete result; failures, skips, timeouts, and unavailable DB service are not counted as green. | PASS |
| No behavior changes made | Final scoped diff for this gate | Gate 0 changed only this execution record; protected pre-existing behavior work was not modified. | PASS |

### Gate decision
**PASS**

**Reason:** Gate 0's acceptance condition is an exact reproducible baseline, not
a green application tree. Repository state, commands, auth coverage gaps, suite
failures, environmental limitations, and pre-existing uncommitted behavior are
all recorded with fresh evidence, and Gate 0 made no behavior change.


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
