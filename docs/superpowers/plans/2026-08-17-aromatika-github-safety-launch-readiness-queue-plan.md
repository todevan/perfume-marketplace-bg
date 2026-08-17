# Aromatika GitHub Safety + Launch Readiness Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub the reviewed synchronization and integration safety rail for Aromatika: protect `main`, require objective verification before integration, maintain a small evidence-backed Launch Readiness engineering queue, and let agents operate the workflow without turning the nontechnical owner into a code reviewer.

**Architecture:** The owner's local workspace is the active working authority. GitHub `main` is the last reviewed synchronized shared baseline. Work happens in isolated branches/worktrees; PRs carry review evidence; CI protects integration; GitHub Issues represent synchronized engineering outcomes under the approved Launch Readiness design. R1/R2 integrate autonomously after required evidence; R3 external/protected actions remain owner-gated.

**Tech Stack:** GitHub repository settings/rulesets, GitHub Actions, Git/`gh`, existing `.github/workflows/ci.yml`, Markdown issue bodies, Superpowers review/execution workflows.

## Global Constraints

- Do not require the owner as a code reviewer.
- Do not weaken CI to obtain green status.
- Do not force-push or directly develop on `main`.
- Do not discard unknown local work to match GitHub.
- Preserve the existing `quality` workflow coverage unless current evidence proves a change is necessary.
- Current known CI job names from a real prior PR were `app` and `database`; re-verify them from a current/recent real run before configuring required checks.
- Do not create a dummy documentation PR merely to discover check names if a real recent PR run already exposes them.
- Configure only capabilities supported by the owner's actual GitHub repository/account.
- If GitHub authentication/admin permission is unavailable, stop at an exact owner handoff instead of guessing.
- GitHub Issues are the synchronized engineering execution queue; local approved product/strategy truth outranks issue wording.
- Queue starts intentionally small: normally 5–9 evidence-backed active issues.
- Strategic objective is Launch Readiness, not Open Beta / Beta 30.
- Do not invent speculative readiness gates or issues merely to fill the queue.
- Final real-world public launch remains an owner decision.

---

### Task 1: Verify local sync, GitHub authority, protection, and current CI evidence

**Files:**
- Read: `.github/workflows/ci.yml`
- Read: `docs/PROJECT-STATUS.md`
- No repository edits unless CI naming is genuinely unstable.

**Interfaces:**
- Consumes: active local workspace and GitHub repository.
- Produces: exact permission/protection/check-name evidence.

- [ ] **Step 1: Verify local sync before GitHub mutations**

```powershell
Set-Location 'C:\Users\Admin\Documents\Сайт парфюми.worktrees\current-main-20260813'
git status --short
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/main
```

If `Remote ahead` or `Diverged`, reconcile first. Preserve unknown local work.

- [ ] **Step 2: Verify authenticated GitHub identity and permission**

```powershell
gh auth status
gh repo view todevan/perfume-marketplace-bg --json nameWithOwner,viewerPermission,visibility,defaultBranchRef
```

Required before protection writes:
- intended account;
- `viewerPermission` = `ADMIN`.

If not admin/authenticated, stop with:

```text
What changed:
The local Agent OS and repository truth are ready, but the current GitHub connection cannot administer repository safety settings.

Your action now:
1. Open GitHub using the account that owns `todevan/perfume-marketplace-bg`.
2. Open the repository.
3. Ensure the coding-agent/GitHub connection can write repository contents and administer repository rules/settings.
4. Do not manually change branch rules yet.
5. Return to the agent.

Sync status:
State the observed local/GitHub state.

Next autonomous steps:
I will re-check the permission, inspect the live protection and CI evidence, and configure the safest supported main-branch rules.

Stop condition:
I will not guess repository settings or weaken protection to work around missing permission.
```

- [ ] **Step 3: Fetch current main protection/ruleset state**

Try classic protection:

```powershell
gh api repos/todevan/perfume-marketplace-bg/branches/main/protection
```

Also inspect repository rulesets if supported:

```powershell
gh api repos/todevan/perfume-marketplace-bg/rulesets
```

Interpret 403 as `not verifiable with current permission`, not “unprotected”.
Interpret 404 from the protection endpoint only after confirming permission/endpoint semantics.

- [ ] **Step 4: Inspect actual recent Actions job/check names**

```powershell
gh run list --repo todevan/perfume-marketplace-bg --workflow quality --limit 10
```

Pick the newest completed real PR run and inspect:

```powershell
gh run view <REAL_RUN_ID> --repo todevan/perfume-marketplace-bg --json event,conclusion,jobs,headSha
```

Expected baseline from prior real PR evidence:
- `app`
- `database`

Use the names GitHub currently emits. Do not guess from YAML.

- [ ] **Step 5: Inspect current CI YAML only for necessary naming changes**

```powershell
Get-Content .github/workflows/ci.yml
```

If the real run already provides stable `app` and `database`, do not modify `ci.yml` for naming.

Only if live checks are unstable/ambiguous, set explicit job names:

```yaml
jobs:
  app:
    name: app
    # existing app steps unchanged

  database:
    name: database
    # existing database steps unchanged
```

Preserve all existing quality coverage.

- [ ] **Step 6: Commit only if CI YAML changed**

```powershell
git add .github/workflows/ci.yml
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "ci: stabilize required check names" }
```

---

### Task 2: Configure `main` protection using supported controls

**Files:**
- GitHub settings only unless Task 1 changed CI naming.
- Update `docs/PROJECT-STATUS.md` only after protection is verified.

**Interfaces:**
- Consumes: verified admin permission + real current check names.
- Produces: GitHub-enforced integration policy.

- [ ] **Step 1: Prefer a repository ruleset if supported; otherwise use classic branch protection**

Target behavior:
- PR required before merge;
- required `quality` checks pass;
- branch up-to-date when reliably supported;
- required conversations resolved when supported;
- force pushes disabled;
- branch deletion disabled;
- no routine bypass actor;
- no owner human code-review requirement.

- [ ] **Step 2: If using classic protection, construct the payload from live check names**

For the currently expected `app` and `database` contexts:

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "app"},
      {"context": "database"}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false,
  "allow_fork_syncing": false
}
```

Before applying, replace the contexts only if Task 1's real run reports different names.

Save to a temporary file outside the repository, then:

```powershell
gh api `
  --method PUT `
  -H "Accept: application/vnd.github+json" `
  repos/todevan/perfume-marketplace-bg/branches/main/protection `
  --input $env:TEMP\aromatika-main-protection.json
```

If GitHub rejects an unsupported field, remove only that field after verifying the returned error. Do not drop required status checks, force-push protection, or deletion protection merely to make the request succeed.

- [ ] **Step 3: Verify effective protection**

```powershell
gh api repos/todevan/perfume-marketplace-bg/branches/main/protection
```

Verify:
- required checks enabled;
- current check names present;
- force pushes false;
- deletions false;
- conversation resolution enabled when supported.

- [ ] **Step 4: Record material status only**

Update `docs/PROJECT-STATUS.md` with a concise verified fact such as:

```markdown
- GitHub `main` protection: verified; PR + required CI enforced.
```

If the setting cannot be verified due provider/account limitation, record:

```markdown
- GitHub `main` protection: not verifiable/configurable with the current authenticated permission; owner action required.
```

Do not create a settings diary.

- [ ] **Step 5: Commit status update if changed**

```powershell
git add docs/PROJECT-STATUS.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "docs: record verified GitHub main protection" }
```

---

### Task 3: Verify the real current launch gaps before creating issues

**Files:**
- Read: `docs/PROJECT-STATUS.md`
- Read: `docs/LAUNCH-GATES.md`
- Read: `PRODUCT.md`
- Read: `docs/BUSINESS-MODEL.md`
- Inspect: `tests/e2e/`, relevant `src/`, relevant `supabase/`

**Interfaces:**
- Consumes: current code/tests/hosted evidence.
- Produces: evidence matrix for the initial queue.

- [ ] **Step 1: Inventory existing E2E/product coverage**

```powershell
Get-ChildItem tests -Recurse -File | Sort-Object FullName | Select-Object -ExpandProperty FullName
rg -n "register|confirm|onboard|listing|upload|publish|discover|offer|accept|chat|complete|cancel|review|report|block|moder|merchant|payment|boost|entitlement" tests src supabase
```

- [ ] **Step 2: Map coverage against current Golden Path**

Create task notes with one row per required slice:

```text
register
email confirmation
onboarding
create listing
upload/publish
second-user discovery
seller/trust view
offer
accept
private chat
seller completion
review
cancellation with reason / no review
report
block
moderation
cross-user denial
paid 11th+ entitlement
promotion entitlement
Verified Merchant launch flow
monitoring
backup/restore
legal/safety
```

For each mark only:
- `verified current`;
- `covered only by demo/local test`;
- `hosted not freshly verified`;
- `missing`;
- `blocked by owner/provider decision`.

Do not mark based on plan text alone.

- [ ] **Step 3: Preserve known prior evidence but re-verify before issue creation**

Prior repository evidence indicated a hosted real-user E2E covered much of:
`listing -> discover -> offer -> accept -> chat -> completion -> review`
with pre-provisioned users, while registration/email-confirmation/onboarding were not in that same hosted journey.

Re-check current tests before creating the registration issue. If the gap still exists, it is a P1/R2 issue.

- [ ] **Step 4: Inventory hostile-security coverage**

Search:

```powershell
rg -n "cross.?user|forbidden|unauthor|RLS|other user|different user|private chat|private upload|report|block|admin|moderator" tests supabase
```

Map actual gaps; do not create duplicate issues for already-proven behavior.

- [ ] **Step 5: Inventory monetization state**

```powershell
rg -n "payment|checkout|webhook|entitlement|boost|featured|listing limit|active listings|30 day|30-day" src tests supabase package.json
```

Classify:
- not implemented;
- partially implemented;
- provider decision blocked;
- implemented but unverified.

- [ ] **Step 6: Commit nothing**

This task produces evidence only.

---

### Task 4: Create/reuse Launch Readiness labels

**Files:**
- GitHub labels only.

**Interfaces:**
- Consumes: current repository labels.
- Produces: consistent queue metadata.

- [ ] **Step 1: List existing labels**

```powershell
gh label list --repo todevan/perfume-marketplace-bg --limit 200
```

- [ ] **Step 2: Ensure these labels exist**

Required:
- `priority:P0`
- `priority:P1`
- `priority:P2`
- `priority:P3`
- `risk:R0`
- `risk:R1`
- `risk:R2`
- `risk:R3`
- `agent:ready`
- `agent:blocked`
- `agent:review`
- `hosted-required`
- `owner-action`
- `launch-readiness`

Create only missing labels using `gh label create`. Colors are cosmetic; reuse an existing project convention if present. Do not block queue creation on label aesthetics.

---

### Task 5: Seed a small evidence-backed Launch Readiness Queue

**Files:**
- GitHub Issues only.

**Interfaces:**
- Consumes: Task 3 evidence matrix.
- Produces: 5–9 active outcome-oriented issues maximum.

- [ ] **Step 1: List current open issues**

```powershell
gh issue list --repo todevan/perfume-marketplace-bg --state open --limit 100
```

Avoid duplicating existing work.

- [ ] **Step 2: Use this exact issue body contract**

```markdown
## Outcome
One observable user/safety/business result.

## Why it matters
Why this blocks or materially improves launch.

## Acceptance criteria
- [ ] Concrete observable condition.
- [ ] Concrete observable condition.

## Verification
- focused tests:
- database/security tests:
- browser/E2E:
- hosted evidence:
- full CI:
- independent review:
- security review if R2:

## Risk
`R0 | R1 | R2 | R3`

## Dependencies
List only real blockers.

## Out of scope
Explicitly name nearby work that must not expand this issue.
```

- [ ] **Step 3: Create the confirmed registration-front-slice issue if Task 3 still shows the gap**

Title:

```text
[P1][R2] Prove open registration, email confirmation and onboarding end-to-end
```

Body acceptance criteria:

```markdown
## Outcome
A brand-new normal user can register without an invitation or phone/SMS gate, confirm their email, complete username/city/consent onboarding, and reach an active marketplace account.

## Why it matters
Aromatika cannot launch as an open marketplace while the real hosted journey depends on pre-provisioned users or an obsolete admission gate.

## Acceptance criteria
- [ ] A new normal user registers with email/password without invitation, waiting list, phone verification or SMS OTP.
- [ ] Email confirmation is required and succeeds.
- [ ] Onboarding requires username, city/location, Terms and Marketplace Rules consent.
- [ ] The completed account can enter the normal marketplace.
- [ ] Staff/admin MFA behavior remains unchanged.
- [ ] Automated coverage proves the journey and relevant hostile auth cases.

## Verification
- focused tests: registration/onboarding unit or contract tests
- database/security tests: auth/profile/RLS boundaries
- browser/E2E: real registration -> confirmation -> onboarding
- hosted evidence: approved staging/production-like target
- full CI: required
- independent review: strong
- security review if R2: required

## Risk
R2

## Dependencies
Hosted email-confirmation test capability and approved non-production target.

## Out of scope
No phone/SMS feature, no invite system, no social login expansion, no unrelated profile redesign.
```

Labels:
`priority:P1,risk:R2,agent:ready,hosted-required,launch-readiness`
unless evidence shows a real owner/provider blocker, in which case use `agent:blocked`.

- [ ] **Step 4: Create additional issues only for evidence-backed gaps**

Use these exact candidate titles only if Task 3 proves the corresponding gap:

```text
[P1][R2] Prove cross-user privacy across offers, accepted chat and evidence
[P1][R2] Complete report, block and moderation safety journey
[P1][R1] Align deal completion and cancellation runtime with current product truth
[P1][R2] Implement secure 10-free / paid-extra listing entitlements
[P1][R2] Implement secure paid listing promotion entitlements
[P1][R1] Make Verified Merchant launch flow production-ready
[P1][R2] Verify monitoring, backup/restore and incident readiness
[P1][R3] Select and activate Aromatika service-payment provider
[P2][R1] Remove highest-friction mobile blocker in the core launch journey
```

Rules:
- Do not create a candidate if current evidence already proves it complete.
- `Select and activate Aromatika service-payment provider` is R3/owner-action and should be `agent:blocked` until the owner/provider decision is required; repository-side research/design may be a separate R1/R2 task only if explicitly approved.
- If more than nine gaps exist, create only the highest-priority launch frontier and record the rest in `PROJECT-STATUS.md` or later issues after frontier completion.
- If fewer than five real gaps exist, do not invent extras.

- [ ] **Step 5: Verify queue size**

```powershell
gh issue list --repo todevan/perfume-marketplace-bg --state open --limit 100
```

Target: approximately 5–9 evidence-backed active issues, not dozens.

---

### Task 6: Establish deterministic issue selection and PR linkage

**Files:**
- No repository change unless `docs/agents/WORKFLOW.md` needs a correction found during live use.

**Interfaces:**
- Consumes: ready queue.
- Produces: predictable autonomous continuation.

- [ ] **Step 1: Selection rule**

Choose:
1. P0 before P1 before P2 before P3;
2. only unblocked issues;
3. security/data-loss before UX within the same priority;
4. work that unlocks the core launch journey before peripheral work;
5. one large active task owner at a time unless work is genuinely independent.

- [ ] **Step 2: At task start, mark issue state with available label/comment**

Use `agent:ready` -> working/in-review convention supported by the repository. If no in-progress label exists, add a concise comment:

```text
Agent work started from the approved local Launch Readiness baseline. Risk and verification will be reported in the PR.
```

- [ ] **Step 3: Branch naming**

```text
issue-<number>-<short-outcome-slug>
```

Example:

```text
issue-24-registration-onboarding-e2e
```

- [ ] **Step 4: PR body contract**

```markdown
Closes #<issue>

## Outcome
Plain-language result.

## Risk
R0/R1/R2/R3.

## Verification
- focused tests:
- database/security tests:
- browser/E2E:
- hosted evidence:
- full CI:
- independent review:
- adversarial security review if R2:

## Product authority
State the current `PRODUCT.md` / launch-design rule implemented.

## Owner action
None, unless this is an R3/protected real-world action.

## Sync status
State local/GitHub state.
```

- [ ] **Step 5: After merge**

Automatically:
- close/reconcile issue;
- update `PROJECT-STATUS.md` only for material state changes;
- fetch/compare local workspace;
- choose highest-priority unblocked next issue;
- continue without asking “what next?” if already authorized.

---

### Task 7: Verify the Golden Path is represented in CI/issue coverage

**Files:**
- Inspect: Playwright tests and fixtures.
- Modify only if a small missing assertion can be safely added; create issues for larger missing slices.

**Interfaces:**
- Consumes: current product core loop.
- Produces: regression evidence protecting Launch Readiness.

- [ ] **Step 1: Map current browser coverage against**

```text
register
-> email confirmation
-> onboarding
-> create listing
-> upload/publish
-> second user discover/view
-> offer
-> accept
-> chat
-> seller completes
-> review
```

Cancellation:

```text
accepted deal
-> either party cancels
-> reason stored
-> review remains locked
```

Safety:

```text
report/block
cross-user access denied
```

Monetization:

```text
10 active qualifying listings
-> attempt 11th
-> trusted payment
-> 30-day entitlement
-> publish
```

- [ ] **Step 2: Do not rewrite existing strong hosted coverage unnecessarily**

If current `tests/e2e/real-beta.spec.ts` or renamed equivalent already proves listing/discovery/offer/chat/review slices, preserve it and extend/rename only when the product semantics require seller-completion/cancellation updates.

- [ ] **Step 3: Create issues for large missing slices**

Do not turn this governance plan into an enormous E2E rewrite. Large missing slices remain Launch Readiness issues with appropriate R1/R2 risk.

- [ ] **Step 4: Ensure current CI still runs Playwright**

Inspect `.github/workflows/ci.yml` and verify the required `quality` path retains Playwright/E2E coverage before trusted integration.

---

### Task 8: Exercise one R1 autonomous integration

**Files:**
- Use a small real R1 issue from the queue.

**Interfaces:**
- Consumes: protection + CI + issue workflow.
- Produces: proof that owner code review is unnecessary for routine work.

- [ ] **Step 1: Implement the R1 issue through Superpowers**

- [ ] **Step 2: Run independent review**

- [ ] **Step 3: Push PR and let required CI run**

- [ ] **Step 4: Confirm GitHub blocks integration until required checks are green**

Do not bypass.

- [ ] **Step 5: Merge autonomously once policy is satisfied**

- [ ] **Step 6: Verify main and local synchronization**

```powershell
git fetch origin
git log -5 --oneline origin/main
gh issue list --repo todevan/perfume-marketplace-bg --state open
```

Then reconcile the owner's primary local workspace without discarding unknown work.

---

### Task 9: Exercise one R2 dry-run workflow safely

**Files:**
- Prefer an existing security-sensitive test-only or bounded launch issue.
- Do not create a risky production mutation only to test the workflow.

**Interfaces:**
- Consumes: R2 workflow.
- Produces: evidence that independent security review is real.

- [ ] **Step 1: Choose a safe R2 issue**

Preferred examples:
- strengthen cross-user RLS denial test;
- add accepted-chat privacy regression test;
- add paid-entitlement forgery/idempotency tests once monetization code exists;
- strengthen moderator access tests.

- [ ] **Step 2: Execute the required sequence**

```text
strong implementer
-> relevant engineering specialist
-> independent strong engineering review
-> adversarial security review
-> deterministic DB/security tests
-> relevant E2E
-> full CI
-> autonomous merge only if all pass
```

- [ ] **Step 3: Preserve review/evidence in the PR**

Do not reduce the result to “AI says secure.”

- [ ] **Step 4: Block on unresolved security finding**

If confidence cannot be established:
- do not merge;
- mark issue blocked/review;
- do not ask the owner to approve the code.

---

### Task 10: Final GitHub verification and owner handoff

**Files:**
- Update `docs/PROJECT-STATUS.md` only with material verified state.

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: verified GitHub operating loop and ready Launch Readiness queue.

- [ ] **Step 1: Verify protection and required checks again**

Use GitHub API/CLI and a real PR.

- [ ] **Step 2: Verify queue**

Confirm:
- active issues are evidence-backed;
- priority/risk present;
- no stale Open Beta naming;
- no duplicate issues for already-complete behavior.

- [ ] **Step 3: Verify R1/R2 workflow evidence**

Confirm:
- R1 integrated without owner code review;
- R2 had independent strong review + security review + deterministic evidence;
- unresolved findings blocked merge.

- [ ] **Step 4: Update status with concise verified facts**

No settings diary.

- [ ] **Step 5: End with**

```text
What changed:
GitHub now acts as Aromatika's reviewed synchronization and integration safety rail. Main is protected as far as the account supports, the Launch Readiness Queue contains only evidence-backed work, and both the R1 and R2 autonomous paths have been exercised without making you a code reviewer.

Your action:
Use `Your action: none.` unless a real GitHub admin/provider limitation remains.

Sync status:
State Synchronized / Local ahead / Remote ahead / Diverged from fresh evidence.

Next autonomous steps:
Take the highest-priority unblocked Launch Readiness issue and continue through the approved workflow. When the work reaches a genuine provider/pricing/legal/final-launch action, stop with exact owner instructions.

Stop condition:
Any unresolved security finding, missing required CI evidence, unsafe local/remote divergence, or protected R3 action blocks autonomous continuation.
```
