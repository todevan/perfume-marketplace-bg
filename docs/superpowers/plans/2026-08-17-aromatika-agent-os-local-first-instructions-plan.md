# Aromatika Agent OS v2 — Local-First Agent Instruction Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Aromatika's duplicated agent-governance layer with a concise local-first Agent OS v2 that treats the owner's PC workspace as the active working authority, GitHub `main` as the last reviewed synchronized baseline, Superpowers as process authority, independent agents/tests as the R2 technical gate, and Launch Readiness as the current engineering objective.

**Architecture:** Root `AGENTS.md` is the short durable constitution. Detailed execution, security, and model-routing rules live in `docs/agents/WORKFLOW.md`, `docs/agents/SECURITY.md`, and `docs/agents/MODEL-ROUTER.md`. Legacy `docs/agents/*` files become tiny compatibility pointers. Local directory `AGENTS.md` files narrow behavior only and may not redefine global product or owner authority.

**Tech Stack:** Markdown, Git, Git worktrees, GitHub/`gh`, existing pnpm/SvelteKit/Supabase validation, Superpowers, relevant Matt Pocock skills.

## Global Constraints

- Strategic objective is **Aromatika Launch Readiness**, not Open Beta / Beta 30.
- Explicit current owner instruction is highest authority.
- The current local Aromatika workspace is the active working authority.
- GitHub `main` is the last reviewed and synchronized shared baseline.
- Before substantial work, fetch/compare local and remote state and preserve unknown local work.
- Never use destructive Git commands merely to make local state match GitHub.
- Superpowers is the primary engineering-process authority.
- Matt Pocock skills deepen the Superpowers lifecycle; they do not create a competing lifecycle.
- The owner is the product/business owner, not the code reviewer.
- R2 code does not require owner code approval; it requires independent strong engineering review, adversarial security review, deterministic security tests, and full CI.
- R3 protected real-world actions remain owner-controlled.
- Every task handoff includes: `What changed`, `Your action`, `Sync status`, `Next autonomous steps`, `Stop condition`.
- Public email/password registration with email confirmation is the normal-user model.
- Normal users do not require invitation, waiting list, phone verification, or SMS OTP.
- Perfume payment/delivery remains off-platform.
- Merchant verification is a trust status and cannot be bought.
- Paid Aromatika entitlements are security-sensitive and cannot be client-granted.
- Start with the cheapest model suitable for the risk; escalate only on evidence, complexity, or consequence.
- Do not modify `main` directly.
- Re-verify current local and remote state at execution time.

---

## File Structure

### Create
- `docs/agents/WORKFLOW.md`
- `docs/agents/SECURITY.md`
- `docs/agents/MODEL-ROUTER.md`

### Rewrite
- `AGENTS.md`
- `docs/agents/AUTONOMY.md`
- `docs/agents/EXECUTION-LOOP.md`
- `docs/agents/HUMAN-GATES.md`
- `docs/agents/SKILL-ROUTER.md`
- `docs/agents/domain.md`
- `docs/agents/issue-tracker.md`

### Inspect and modify only on contradiction
- `src/AGENTS.md`
- `supabase/AGENTS.md`
- `tests/AGENTS.md`

---

### Task 1: Reconcile the local workspace with GitHub before editing

**Files:**
- Read: `AGENTS.md`
- Read: `docs/PROJECT-STATUS.md`
- Read: `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`
- Read: existing `docs/agents/*.md`
- No file changes in this task.

**Interfaces:**
- Consumes: local working tree and `origin/main`.
- Produces: a classified sync state and an isolated worktree/branch based on the correct baseline.

- [ ] **Step 1: Enter the owner's active workspace**

Run from PowerShell:

```powershell
Set-Location 'C:\Users\Admin\Documents\Сайт парфюми.worktrees\current-main-20260813'
git status --short
git branch --show-current
git rev-parse HEAD
```

Expected:
- current local changes are visible;
- no unknown change is discarded.

- [ ] **Step 2: Fetch without changing local files**

```powershell
git fetch origin --prune
git rev-parse origin/main
git log --oneline --decorate --max-count=8 --all
```

- [ ] **Step 3: Classify sync state**

Run:

```powershell
git rev-list --left-right --count HEAD...origin/main
```

Interpret exactly:
- `0 0` = synchronized commit graph; uncommitted local files may still make the workspace `Local ahead`.
- `<positive> 0` = local branch has commits not on `origin/main`.
- `0 <positive>` = remote ahead.
- `<positive> <positive>` = diverged.

Also inspect:

```powershell
git status --short
```

If the state is `Remote ahead` or `Diverged`, reconcile before continuing. Do not run `git reset --hard`, `git clean -fd`, or discard unknown work.

- [ ] **Step 4: Create an isolated worktree only after the baseline is understood**

Choose a parent commit that preserves the approved local state. If the approved state is already committed on the current local branch:

```powershell
git worktree add '..\agent-os-v2-launch-readiness' -b agent-os-v2-launch-readiness HEAD
Set-Location '..\agent-os-v2-launch-readiness'
```

If approved changes are still uncommitted, first commit them on the active local branch with an owner-approved design commit, then create the worktree from that commit.

Expected:
- no feature/governance editing happens directly on `main`;
- the worktree contains `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`.

- [ ] **Step 5: Capture the active contradiction baseline**

```powershell
rg -n "Open Beta|Beta 30|open-beta|owner approval|H3|R2|invite|phone|SMS|OTP|main.*trusted|canonical executable queue|What changed|Sync status" `
  AGENTS.md docs src supabase tests PRODUCT.md DESIGN.md README.md
```

Save the output in task notes/PR description only. Do not create a permanent scan dump.

- [ ] **Step 6: Commit nothing**

This task is evidence gathering and isolation only.

---

### Task 2: Rewrite root `AGENTS.md` as the local-first constitution

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`.
- Produces: the root authority read at every agent session.

- [ ] **Step 1: Replace root `AGENTS.md` with these sections and rules**

Use this exact section order:

```markdown
# AGENTS.md

## Mission
Build Aromatika toward a safe, trustworthy, monetized public launch in Bulgaria.

The owner is the product/business owner, not the technical reviewer. Agents own implementation, engineering review, verification, repair, routine Git/GitHub mechanics, and safe autonomous continuation. Do not ask the owner to approve code they cannot meaningfully review.

Priority:
1. security, privacy, authorization and data integrity;
2. blockers in the core launch journey;
3. user experience, accessibility, reliability and performance;
4. launch monetization and marketplace activation required by the approved design;
5. maintainability required for current work;
6. deferred scalability or future features only when explicitly required.

Ask: "Does this materially improve safe progress toward launching Aromatika?"

## Authority
When instructions conflict:
1. explicit current owner instruction;
2. current local workspace state intentionally created for the active task;
3. `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`;
4. this `AGENTS.md`;
5. current concern-specific authority: `PRODUCT.md`, `DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT-STATUS.md`, `docs/LAUNCH-GATES.md`, `docs/BUSINESS-MODEL.md`, and relevant agent/security docs;
6. active implementation plan or GitHub issue;
7. GitHub `main` as the last reviewed synchronized shared baseline;
8. historical plans/reviews/builder artifacts.

Historical files are evidence only unless an active task explicitly promotes them.

Local does not blindly override remote: before substantial work, fetch and compare. Preserve unknown local work. Reconcile unexpected remote-ahead/diverged state before continuing.

## Session startup
Read:
1. `AGENTS.md`;
2. `docs/PROJECT-STATUS.md`;
3. current owner task or active issue;
4. directory-specific `AGENTS.md` for files being touched.

Load when relevant:
- `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md` for strategy/launch scope;
- `PRODUCT.md` for product behavior;
- `DESIGN.md` for UI/UX;
- `docs/ARCHITECTURE.md` for architecture/backend;
- `docs/agents/WORKFLOW.md` for substantial engineering work;
- `docs/agents/SECURITY.md` for R2/R3/security work;
- `docs/agents/MODEL-ROUTER.md` for model/delegation selection;
- launch/provider/backup/incident/business docs only when the task touches them.

Never scan all historical plans at startup.

## Engineering process
Superpowers is the primary process authority and is mandatory where applicable.

Matt Pocock skills are preferred engineering-depth specialists inside the Superpowers lifecycle. Invoke them automatically when their trigger applies and they are available. They do not create a second planning/debugging/TDD/review lifecycle.

The owner does not orchestrate skills.

## Risk model
### R0 — trivial/reversible
Docs, comments, formatting, internal metadata.
Flow: cheap worker -> lightweight checks -> merge.

### R1 — normal product engineering
Ordinary UI/features/bugs/tests/refactors inside established security boundaries.
Flow: implementer -> independent review -> relevant tests -> required CI -> autonomous merge.

### R2 — security-sensitive
Material changes to auth/session/registration/reset/MFA, RLS/authorization, staff/admin/moderator access, private data/Storage, uploads/evidence, chat privacy, reports/blocking/moderation, account lifecycle, service role, `SECURITY DEFINER`, secrets/security config, cross-user visibility, paid-entitlement authorization, or security-sensitive provider/payment integration.
Flow: strong implementer -> relevant specialist -> independent strong engineering review -> adversarial security review -> deterministic security tests -> full CI -> autonomous merge only when every gate passes.
The owner does not approve R2 code. Failure to prove safety means do not merge.

### R3 — protected real-world operation
Destructive production-data actions, production credentials/secrets, DNS/domain changes, irreversible production migrations, disabling security controls, legal/privacy/business-policy changes, meaningful spending, accepting provider commercial terms, owner-approved launch pricing changes, and the final public launch action.
Agents may investigate, implement, test, review, and prepare rollback autonomously. The protected real-world action requires the owner decision/action.

## Product/security invariants
- Normal users register with email/password, confirm email, complete onboarding, and do not require invites, waiting lists, phone verification, or SMS OTP.
- Staff/admin MFA remains mandatory.
- Perfume payment/delivery remains off-platform.
- Merchant verification is a trust status and is not purchased.
- Seller completion and either-party cancellation are current transaction truth; see `PRODUCT.md`.
- Aromatika monetization uses the approved 10-free qualifying active listings, paid 11th+ 30-day listings, and paid promotion model; see `docs/BUSINESS-MODEL.md`.
- Paid entitlements require trusted server-side confirmation and cannot be granted by browser-controlled state.
- Fail closed at authorization boundaries.
- Treat RLS/database authorization as a real security boundary.
- Never expose service-role or secret credentials to browser code, source control, logs, issues, PRs, or chat.
- Preserve private-data minimization and least privilege.
- Never weaken security controls, tests, branch protection, or CI to make progress.
- Do not claim authenticity guarantees beyond approved trust language.

## Git and synchronization
- The local workspace is the active working authority for intentional current work.
- GitHub `main` is the last reviewed synchronized baseline.
- Never develop directly on `main`.
- Use an isolated branch/worktree for non-trivial work.
- Never force-push `main`.
- Never bypass required checks.
- Never destroy unknown local work to match remote state.
- Merge and deploy are separate.
- GitHub Issues are the synchronized executable engineering queue after migration; they do not redefine product truth.
- Prefer one active task owner; parallelize only genuinely independent work.

## Model/token discipline
Follow `docs/agents/MODEL-ROUTER.md`.
Spend intelligence where mistakes are expensive and cheap tokens where work is mechanical.
Use minimum sufficient delegated context. Prefer deterministic tools/tests over repeated model opinions. Stop bounded retry loops instead of burning tokens indefinitely.

## Completion
A task is not complete because code was written.

Completion requires applicable acceptance criteria, tests, framework/type checks, database/security checks, browser/E2E verification, independent review, CI, and risk-specific review.

Never fabricate a PASS.

## Mandatory owner handoff
Every completed or blocked task ends with:

### What changed
User-facing/business/safety outcome.

### Your action
Use exactly:
- `Your action: none.`
- `Your action now:` followed by exact sequential owner instructions.

### Sync status
Use exactly one:
- `Synchronized`
- `Local ahead`
- `Remote ahead`
- `Diverged`

### Next autonomous steps
State what the agents will do next when work is already authorized.

### Stop condition
State missing evidence/decision and preserve the working system.

Do not end with only "done", "fixed", "merged", a commit hash, or raw logs.
```

- [ ] **Step 2: Verify obsolete governance language is absent**

```powershell
rg -n "Open Beta|Beta 30|owner approval before merge|R2 merge approval|H3|invite-only authentication|Public registration is disabled|phone verification required|canonical executable queue" AGENTS.md
```

Expected: no obsolete rule matches.

- [ ] **Step 3: Verify required concepts are present**

```powershell
rg -n "Launch Readiness|local workspace|GitHub `main`|Superpowers|Matt Pocock|R0|R1|R2|R3|Your action: none|Sync status|Next autonomous steps|paid-entitlement|10-free" AGENTS.md
```

Expected: all concepts present.

- [ ] **Step 4: Commit**

```powershell
git add AGENTS.md
git commit -m "docs: establish local-first Agent OS v2 constitution"
```

---

### Task 3: Create `docs/agents/WORKFLOW.md`

**Files:**
- Create: `docs/agents/WORKFLOW.md`

**Interfaces:**
- Consumes: root risk/authority model.
- Produces: one detailed execution lifecycle.

- [ ] **Step 1: Create the workflow**

Write:

```markdown
# Agent Workflow

## Purpose
One engineering lifecycle per task. Superpowers owns the lifecycle; specialists contribute inside it.

## Work selection
Work from:
1. explicit current owner request;
2. highest-priority unblocked Launch Readiness issue;
3. genuine security/reliability defect discovered while doing authorized work.

The approved local design/product/status documents define direction. GitHub Issues are the synchronized engineering execution queue and may not redefine product truth.

Do not start speculative refactors, deferred features, or unrelated research.

Priority:
- P0 active safety/data-loss/security blocker;
- P1 core launch journey or launch monetization blocker;
- P2 launch-value UX/accessibility/performance/reliability;
- P3 later/deferred.

## Local-first startup
Before substantial work:
1. inspect `git status`;
2. fetch `origin`;
3. compare `HEAD` and `origin/main`;
4. classify sync state;
5. preserve unknown local work;
6. reconcile `Remote ahead` or `Diverged` before editing.

Never hard-reset or clean unknown local work merely to match GitHub.

## Standard lifecycle
`understand -> classify risk -> reconcile local/remote -> isolate work -> plan if needed -> implement with TDD/evidence -> verify locally -> independent review -> repair valid findings -> required CI -> merge when policy allows -> synchronize -> reconcile status/issue -> owner handoff -> next task`

## Superpowers + specialists
Use applicable Superpowers process skills first.
Automatically add relevant Matt/specialist depth inside that lifecycle.
Do not run duplicate generic planners, TDD loops, debugging loops, or completion protocols.

## Isolation
Non-trivial changes use a branch/worktree. Never develop directly on `main`. Never discard unknown work.

## TDD and evidence
For behavior changes:
1. express required behavior in a failing deterministic test where practical;
2. confirm the test fails for the intended reason;
3. implement the smallest correct change;
4. confirm focused test passes;
5. run broader affected tests;
6. run risk-required verification.

Documentation-only changes use deterministic authority/contradiction/link checks rather than fake code tests.

## Review
The implementer does not certify itself.

R1 requires independent engineering review.

R2 requires:
1. independent strong engineering review;
2. separate adversarial security review;
3. deterministic security evidence;
4. full CI.

Verify review claims technically; do not obey hallucinated feedback blindly.

## Repair budget
Default:
1. diagnose and repair with evidence;
2. retry using new evidence/different approach;
3. escalate to stronger reasoning/specialist only when justified.

After repeated evidence-based failure:
- stop;
- do not merge;
- preserve the working system;
- record the blocker;
- provide the mandatory owner handoff.

Do not ask the owner to debug code.

## GitHub issue contract
A ready issue contains:
- outcome;
- why it matters;
- acceptance criteria;
- required verification;
- risk;
- dependencies;
- out of scope.

Prefer outcome language over file chores.

## Merge behavior
R0: lightweight checks -> merge.
R1: independent review + relevant tests + required CI -> autonomous merge.
R2: strong implementation + independent strong review + adversarial security review + deterministic security tests + full CI -> autonomous merge only if all pass.
R3: repository-side work may complete, but protected real-world action remains owner-gated.

Never lower tests or protection to obtain green CI.

## End-of-task handoff
Every task ends with:
- What changed
- Your action
- Sync status
- Next autonomous steps
- Stop condition

If no owner action is needed, say exactly: `Your action: none.`
```

- [ ] **Step 2: Verify no owner code-review gate was reintroduced**

```powershell
rg -n "owner approval.*merge|owner.*review.*code|owner.*approve.*R2|H3" docs/agents/WORKFLOW.md
```

Expected: no matches.

- [ ] **Step 3: Commit**

```powershell
git add docs/agents/WORKFLOW.md
git commit -m "docs: add local-first autonomous workflow"
```

---

### Task 4: Create `docs/agents/SECURITY.md`

**Files:**
- Create: `docs/agents/SECURITY.md`

**Interfaces:**
- Consumes: root R2/R3 definitions.
- Produces: security escalation and verification contract.

- [ ] **Step 1: Create the security document**

Write:

```markdown
# Agent Security Rules

## Objective
Protect user data, paid entitlements, and marketplace trust through defense in depth. Fail closed when safety cannot be proven.

## R2 triggers
Treat a material change as R2 when it touches:
- authentication/session/registration/reset/MFA;
- RLS/authorization;
- staff/admin/moderator authorization;
- private user data or private Storage;
- uploads/evidence trust boundaries;
- chat/messages privacy;
- reports/blocking/moderation/retention;
- account deletion/export/anonymization;
- service-role use;
- `SECURITY DEFINER`;
- secrets/security configuration;
- cross-user visibility;
- paid listing/promotion entitlements;
- payment webhooks/provider callbacks;
- security-sensitive provider configuration.

## Mandatory R2 gate
R2 cannot merge until all applicable items pass:
1. strong-enough implementation;
2. relevant engineering specialist;
3. independent strong engineering review;
4. independent adversarial security review;
5. deterministic security tests;
6. database/RLS tests when authorization changes;
7. browser/E2E tests when user journeys change;
8. payment/webhook idempotency and forgery tests when monetization changes;
9. dependency/static checks applicable to the change;
10. full required CI.

The owner does not approve R2 code.

If required confidence cannot be established, do not merge.

## Authorization
- RLS/database policy is a security boundary.
- Inspect real migrations, policies, functions, grants, and Storage rules.
- Do not infer access control only from UI or TypeScript.
- Test hostile clients across ownership/cross-user boundaries.
- Service role is server-only and must never bypass the user authorization model.
- `SECURITY DEFINER` requires explicit privilege review and tests.

## Hostile-client examples
Where relevant, prove User A cannot:
- read User B's private record;
- modify User B's listing;
- read User B's private chat;
- access User B's private uploads/evidence;
- invoke moderator/admin actions;
- manipulate User B's deal;
- spoof ownership;
- grant themselves paid listing/promotion entitlements;
- bypass payment completion;
- escalate privileges through user-controlled fields;
- bypass ownership by direct API/database calls;
- obtain private URLs/secrets through error behavior.

## Paid entitlement rules
- Browser-controlled state never grants an entitlement.
- Create entitlements only from trusted server-side confirmation.
- Provider callbacks/webhooks must be authenticated according to the selected provider.
- Callback handling must be idempotent.
- Duplicate callbacks must not duplicate entitlements.
- Failed/abandoned payments must not create entitlements.
- Refund/cancellation state must remain auditable.
- Never log/store card details when the provider can retain them.

## Uploads/evidence
Preserve:
`quarantine -> validate real MIME/content/dimensions/limits -> re-encode/sanitize -> strip metadata -> finalized sanitized object -> delete private original according to policy`

Never trust filename or browser-declared MIME alone.

## Secrets/environments
- Never commit secrets.
- Never paste secrets into issues, PRs, logs, or chat.
- Verify exact provider/project/environment before hosted mutation.
- Staging and production must remain distinguishable and fail closed.
- Production/destructive/provider actions may be R3 even when repository implementation is complete.

## Staff access
Staff/admin MFA/AAL2 remains mandatory.

## Security review failure
A security finding blocks completion until disproved with evidence or fixed and covered by regression tests.
Never waive a finding merely to ship.

## R3 protected actions
Agents may prepare and verify repository-side work, rollback steps, and exact instructions. The real external/destructive/legal/spending/launch action remains owner-controlled.
```

- [ ] **Step 2: Verify mandatory concepts**

```powershell
rg -n "Mandatory R2 gate|The owner does not approve R2 code|Paid entitlement|Hostile-client|R3 protected" docs/agents/SECURITY.md
```

Expected: all present.

- [ ] **Step 3: Commit**

```powershell
git add docs/agents/SECURITY.md
git commit -m "docs: add launch and monetization security rules"
```

---

### Task 5: Create `docs/agents/MODEL-ROUTER.md`

**Files:**
- Create: `docs/agents/MODEL-ROUTER.md`

**Interfaces:**
- Consumes: risk classification.
- Produces: model/delegation routing rules.

- [ ] **Step 1: Create the model router**

Write:

```markdown
# Model Router

## Principle
Spend intelligence where mistakes are expensive. Spend cheap tokens where work is mechanical.
These are capability tiers, not permanent vendor bindings.

## SCOUT
Cheapest reliable model for:
- repository search;
- locating files/tests;
- evidence collection;
- log summarization;
- simple documentation cleanup;
- mechanical low-risk edits.

SCOUT gathers evidence but does not make the final R2 judgment.

## BUILDER
Cheap/medium capable coding model for:
- straightforward UI;
- simple bugs;
- routine tests;
- bounded mechanical refactors;
- implementation with already-clear security/architecture boundaries.

## LEAD
Strong model for:
- architecture;
- difficult debugging;
- ambiguous/high-impact work;
- database/domain design;
- important business logic;
- payment/entitlement design;
- resolving reviewer disagreement;
- deciding whether lower-tier work is safe to accept.

## REVIEWER
Separate context from implementer and strong enough for the risk.
R1: independent capable reviewer.
R2: independent strong reviewer.

## CRITICAL
Not a model name:
`strong LEAD + independent strong REVIEWER + adversarial security review + deterministic evidence`
Use for R2.

## Escalation
Start at the cheapest safe tier.
Escalate when:
- security/privacy/auth/RLS/payment entitlement is involved;
- architecture/database invariants are unclear;
- repeated focused tests fail;
- evidence contradicts expected design;
- reviewer disagreement cannot be resolved cheaply;
- blast radius is high.

If strong reasoning reduces the remainder to mechanical work, delegate mechanics downward and review the result.

## Context packets
Delegated workers receive only:
- task/outcome;
- relevant files;
- constraints;
- acceptance criteria;
- required tests/evidence.

Do not paste the whole repository history/governance into every subagent.

## Spawn discipline
Default: one task owner.
Delegated workers do not recursively create large agent trees unless the lead explicitly authorizes a defined independent parallelization need.

## Retry budget
1. diagnose and repair;
2. retry using new evidence/different approach;
3. escalate only when justified.
After repeated failure, stop instead of burning tokens indefinitely.

## Cost rules
1. Start with the cheapest model suitable for risk.
2. Escalate on demonstrated complexity/consequence.
3. Do not use several strong agents for routine work.
4. Minimize delegated context.
5. Prefer tools/tests/search over another LLM opinion.
6. Avoid duplicate generic reviews.
7. Stop unproductive retry loops.
8. Do not perform speculative refactors.
9. Do not research deferred features without an active need.
10. Optimize for safe progress per token.
```

- [ ] **Step 2: Verify tiers and cost rules**

```powershell
rg -n "SCOUT|BUILDER|LEAD|REVIEWER|CRITICAL|Context packets|Spawn discipline|safe progress per token" docs/agents/MODEL-ROUTER.md
```

- [ ] **Step 3: Commit**

```powershell
git add docs/agents/MODEL-ROUTER.md
git commit -m "docs: add cost-aware launch model routing"
```

---

### Task 6: Convert legacy agent documents into compatibility pointers

**Files:**
- Modify: `docs/agents/AUTONOMY.md`
- Modify: `docs/agents/EXECUTION-LOOP.md`
- Modify: `docs/agents/HUMAN-GATES.md`
- Modify: `docs/agents/SKILL-ROUTER.md`
- Modify: `docs/agents/domain.md`
- Modify: `docs/agents/issue-tracker.md`

**Interfaces:**
- Consumes: new root/WORKFLOW/SECURITY/MODEL-ROUTER.
- Produces: stable old paths that cannot compete with current authority.

- [ ] **Step 1: Replace each legacy file with a short pointer**

`docs/agents/AUTONOMY.md`:

```markdown
# Legacy pointer: autonomy

This path is retained for compatibility with historical links and is **not current authority**.

Use:
- `../../AGENTS.md` for repository constitution and owner/local/GitHub authority;
- `WORKFLOW.md` for engineering autonomy/lifecycle;
- `SECURITY.md` for R2/R3 boundaries.

Do not recover old beta or owner-code-approval gates from Git history unless an active investigation explicitly requires historical evidence.
```

`docs/agents/EXECUTION-LOOP.md`:

```markdown
# Legacy pointer: execution loop

This path is retained for compatibility and is **not current authority**.

Use:
- `../../AGENTS.md`;
- `WORKFLOW.md`;
- `MODEL-ROUTER.md`.

Historical execution-loop text may be inspected only when an active task explicitly requires it.
```

`docs/agents/HUMAN-GATES.md`:

```markdown
# Legacy pointer: owner gates

This path is retained for compatibility and is **not current authority**.

Use:
- `../../AGENTS.md` for owner role and R0-R3;
- `SECURITY.md` for R2/R3;
- `WORKFLOW.md` for task handoff.

The owner is not a code-review gate. R2 code is reviewed by independent agents and deterministic checks. Genuine product/business/legal/spending/protected real-world actions remain owner decisions.
```

`docs/agents/SKILL-ROUTER.md`:

```markdown
# Legacy pointer: skill routing

This path is retained for compatibility and is **not current authority**.

Current routing:
- `../../AGENTS.md` — Superpowers/specialist relationship;
- `WORKFLOW.md` — process usage;
- `MODEL-ROUTER.md` — model/subagent routing;
- `SECURITY.md` — security specialist triggers.

Superpowers remains process authority. Specialist skills add engineering depth inside that lifecycle.
```

`docs/agents/domain.md`:

```markdown
# Legacy pointer: domain authority

This path is retained for compatibility and is **not current authority**.

Use:
- `../AROMATIKA-LAUNCH-READINESS-DESIGN.md` for strategic launch direction;
- `../../PRODUCT.md` for product truth;
- `../../DESIGN.md` for visual/UX truth;
- `../ARCHITECTURE.md` for technical architecture;
- `../PROJECT-STATUS.md` for current operational state;
- `../BUSINESS-MODEL.md` for monetization;
- the active issue/spec for task-specific acceptance criteria.

Historical plans do not override these current authorities.
```

`docs/agents/issue-tracker.md`:

```markdown
# Legacy pointer: issue workflow

This path is retained for compatibility and is **not current authority**.

Use `WORKFLOW.md` for the current Launch Readiness issue contract, priority, execution loop, and merge behavior.

GitHub Issues are the synchronized engineering execution queue. They do not redefine current local product/strategy truth.
```

- [ ] **Step 2: Verify files are tiny and non-authoritative**

```powershell
wc -c docs/agents/AUTONOMY.md docs/agents/EXECUTION-LOOP.md docs/agents/HUMAN-GATES.md `
  docs/agents/SKILL-ROUTER.md docs/agents/domain.md docs/agents/issue-tracker.md
rg -n "not current authority" docs/agents
```

- [ ] **Step 3: Commit**

```powershell
git add docs/agents
git commit -m "docs: retire competing Agent OS v1 instructions"
```

---

### Task 7: Reconcile directory-local agent instructions

**Files:**
- Inspect: `src/AGENTS.md`
- Inspect: `supabase/AGENTS.md`
- Inspect: `tests/AGENTS.md`
- Modify only contradictions.

**Interfaces:**
- Consumes: root constitution.
- Produces: local rules that narrow scope without redefining global product/authority.

- [ ] **Step 1: Search contradictions**

```powershell
rg -n "Open Beta|Beta 30|invite|phone|SMS|OTP|owner approval|H3|R2|both confirm|mutual confirm|canonical" `
  src/AGENTS.md supabase/AGENTS.md tests/AGENTS.md
```

- [ ] **Step 2: If regular-user admission is stale, replace only the stale paragraph with**

```markdown
Regular-user admission uses public email/password registration, email confirmation, and onboarding. Do not introduce invitation, waiting-list, phone verification, or SMS OTP as normal-user activation/listing/offer requirements. Staff/admin MFA remains mandatory.
```

- [ ] **Step 3: If transaction completion is stale, replace only the stale paragraph with**

```markdown
Current transaction truth is seller-controlled completion after an accepted-offer chat. Either buyer or seller may cancel an accepted deal with a required reason. Cancelled deals do not unlock reviews. Product semantics live in `PRODUCT.md`.
```

- [ ] **Step 4: Verify local files do not override R2 or authority**

```powershell
rg -n "owner approval.*R2|owner.*approve.*merge|invite-only.*normal|phone.*required.*regular|both.*confirm.*complete|mutual.*confirm.*complete" `
  src/AGENTS.md supabase/AGENTS.md tests/AGENTS.md
```

Expected: no contradictory rule.

- [ ] **Step 5: Commit only if changed**

```powershell
git add src/AGENTS.md supabase/AGENTS.md tests/AGENTS.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "docs: align local agent rules with Launch Readiness" }
```

---

### Task 8: Run authority and contradiction verification

**Files:**
- Test: active agent-authority Markdown.

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces: evidence that Agent OS v2 is coherent.

- [ ] **Step 1: Verify Launch Readiness and local-first authority**

```powershell
rg -n "Launch Readiness|local workspace|GitHub `main`|Sync status" AGENTS.md docs/agents
```

- [ ] **Step 2: Verify fake R2 owner approval is gone**

```powershell
rg -n "R2.*owner approval|owner approval.*R2|owner approval before merge|H3.*merge|owner.*code review" `
  AGENTS.md docs/agents src/AGENTS.md supabase/AGENTS.md tests/AGENTS.md
```

Expected: no active rule requiring owner code approval.

- [ ] **Step 3: Verify no stale normal-user admission rule**

```powershell
rg -n -i "invite-only authentication|public registration is disabled|публичната регистрация е изключена|regular user.*phone.*required|normal user.*invite.*required" `
  AGENTS.md docs/agents src/AGENTS.md supabase/AGENTS.md tests/AGENTS.md
```

Expected: no matches.

- [ ] **Step 4: Run baseline repository checks**

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:unit
```

Expected: PASS.

- [ ] **Step 5: Independent review**

Review specifically:
- local vs GitHub authority;
- Launch Readiness terminology;
- R2/R3 boundaries;
- owner role;
- paid-entitlement security;
- duplicate lifecycles;
- required handoff including Sync status;
- accidental loss of durable security rules.

Use Superpowers review workflow and `writing-for-agents`/code-review specialist depth when available.

- [ ] **Step 6: Commit review fixes**

```powershell
git add AGENTS.md docs/agents src/AGENTS.md supabase/AGENTS.md tests/AGENTS.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "docs: resolve Agent OS v2 review findings" }
```

---

### Task 9: Final verification, PR, CI, merge, and owner handoff

**Files:**
- No new file changes expected.

**Interfaces:**
- Consumes: completed migration branch.
- Produces: reviewed synchronized Agent OS v2 state.

- [ ] **Step 1: Run final local verification**

```powershell
pnpm validate:catalog
pnpm test:unit
pnpm test:db:contracts
pnpm check
pnpm test:e2e
```

Expected: PASS. Never fabricate PASS if hosted/provider credentials are absent.

- [ ] **Step 2: Push branch**

```powershell
git push -u origin agent-os-v2-launch-readiness
```

- [ ] **Step 3: Open PR**

```powershell
gh pr create `
  --base main `
  --head agent-os-v2-launch-readiness `
  --title "docs: migrate Aromatika to local-first Agent OS v2" `
  --body "Migrates repository governance to the owner-approved Launch Readiness design: local workspace as active working authority, GitHub main as synchronized baseline, Superpowers process authority, autonomous R2 technical review, cost-aware model routing, minimal startup context, paid-entitlement security, and mandatory Sync status handoffs. No application behavior is intentionally changed."
```

- [ ] **Step 4: Wait for required CI and independent review**

Do not merge if any required check fails or required review finding remains unresolved.

- [ ] **Step 5: Merge only when policy allows**

Use auto-merge if correctly protected/supported; otherwise merge only after observing all required evidence.

- [ ] **Step 6: Reconcile local workspace after merge**

From the owner's primary workspace:

```powershell
Set-Location 'C:\Users\Admin\Documents\Сайт парфюми.worktrees\current-main-20260813'
git fetch origin --prune
git status --short
git rev-list --left-right --count HEAD...origin/main
```

Do not overwrite intentional local work. Bring the workspace to the merged baseline using a safe merge/rebase/update appropriate to the observed state.

- [ ] **Step 7: End with this handoff shape**

```text
What changed:
Aromatika's local agent instructions now use one smaller operating system: your PC workspace is the active working authority, GitHub is the reviewed synchronized baseline, Superpowers runs engineering, and R2 security work is reviewed by agents/tests rather than by you.

Your action: none.

Sync status:
Synchronized.

Next autonomous steps:
Execute the Repository Truth and Launch Readiness cleanup plan so every active product, launch, transaction and monetization document tells the same story.

Stop condition:
If local and GitHub state cannot be reconciled without risking unknown work, or CI/review finds a lost security invariant, stop and preserve both states instead of forcing synchronization.
```
