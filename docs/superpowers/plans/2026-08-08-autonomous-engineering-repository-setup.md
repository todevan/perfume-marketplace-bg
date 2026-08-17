# Autonomous Engineering Repository Setup Implementation Plan

**Plan date:** 2026-08-08
**Role:** Historical implementation plan and reusable validation contract for the repository autonomy operating model.
**Plan date:** 2026-08-08  
**Role:** Historical implementation plan and reusable validation contract for the repository autonomy operating model.  
**Execution semantics reconciled:** 2026-08-11.

> This plan records how the repository autonomy model was intended to be established and validated. It is not an instruction to reinstall skills, recreate governance files, or repeat setup work merely because a checkbox below is unchecked.
>
> Current repository instructions and the current contents of `AGENTS.md` and `docs/agents/` are authoritative.

**Goal:** Convert the perfume marketplace repository from owner-interrupt-heavy development to risk-tiered autonomous engineering where R0/R1 work can flow through verified merge automatically, R2 work stops for plain-English owner approval before merge, and R3 protected actions remain human-controlled.

**Architecture:** Keep root `AGENTS.md` concise and authoritative, with detailed policy split into `docs/agents/`. GitHub Issues are the executable queue. Superpowers owns the process lifecycle; Matt Pocock skills provide deep engineering reasoning; ECC and platform capabilities provide specialist expertise. Existing marketplace architecture, privacy, migration, release and pre-launch constraints remain unchanged.

**Tech Stack:** SvelteKit, TypeScript, Supabase/PostgreSQL/RLS, Cloudflare Workers, Vitest, Playwright, pgTAP/Supabase CLI, GitHub Issues/Actions, Superpowers, Matt Pocock skills, ECC/platform specialists.

## Authority model

For current engineering work, use this order:

1. explicit current owner instructions;
2. repository instructions / `AGENTS.md`;
3. authoritative current product, phase and status documents;
4. architecture, launch, security and operational documents, including repository-defined verification and release gates;
5. the applicable `docs/agents/` policy;
6. canonical GitHub Issue and explicitly authorized task/gate scope;
7. Superpowers as the primary process authority;
8. Matt Pocock deep-engineering skills when useful;
9. ECC/platform specialists when useful;
10. external/global generic defaults.

Repository-defined verification and release gates bind every skill layer below them.
1. repository instructions / `AGENTS.md`;
2. authoritative repository product, architecture, security, business, legal and operational docs;
3. current `docs/PROJECT-STATUS.md` and active named-gate documentation;
4. canonical GitHub Issue and explicitly authorized task/gate scope;
5. Superpowers as the primary process authority;
6. Matt Pocock deep-engineering skills when useful;
7. ECC/platform specialists when useful;
8. repository-defined verification and release gates.

Skills are reasoning and execution tools. They are not independent sources of project truth and do not create their own permission to mutate the repository, providers, staging or production.

A correctly scoped task does not imply permission for adjacent work. In particular, an instruction such as `A9 only` remains a strict mutation boundary.

## Unified skill architecture

### PROCESS — Superpowers

Superpowers owns the engineering lifecycle, including as applicable:

- brainstorming;
- writing plans;
- systematic debugging;
- test-driven development;
- isolated worktree/branch execution;
- implementation execution;
- requesting and receiving code review;
- verification before completion;
- branch completion.

Do not start a second competing planner, debugging methodology, TDD loop, execution framework, review loop, or completion loop.

### DEEP ENGINEERING — Matt Pocock

Use Matt skills when they materially improve the current Superpowers step.

Primary examples:

- `diagnosing-bugs`;
- `domain-modeling`;
- `codebase-design`;
- `code-review`;
- `wizard`;
- `writing-for-agents`.

Matt skills deepen diagnosis, modeling, design, review, or agent-facing communication. They do not replace the Superpowers process owner.

### SPECIALISTS — ECC / platform capabilities

Use specialist capabilities for the technical surface that requires them, for example:

- security;
- backend;
- E2E / Playwright;
- evals;
- documentation lookup;
- Supabase;
- Cloudflare;
- GitHub integrations.

Specialists provide domain expertise inside the current process. They do not independently redefine product behavior, risk, authorization, completion criteria, or project state.

### Typical routing

Bug:

```text
Superpowers systematic-debugging
→ Matt diagnosing-bugs when useful
→ Superpowers TDD / implementation
→ independent review
→ verification-before-completion
```

Feature:

```text
Superpowers brainstorming / writing-plans
→ Matt domain-modeling / codebase-design when useful
→ Superpowers TDD / execution
→ independent review
→ verification-before-completion
```

Security-sensitive change:

```text
Superpowers process
→ Matt design/domain reasoning when useful
→ ECC security/platform specialist
→ independent review
→ verification
→ H3 before merge when classified R2
```

## Global Constraints

- Preserve server-first architecture and current product/privacy/security decisions.
- Normal users register publicly with email/password and complete email confirmation.
- Do not reintroduce invitation-only registration or phone/SMS OTP requirements for normal-user activation, first listing, offers, or ordinary marketplace actions.
- Legacy invitation/bootstrap logic may remain only where explicitly required for operator or first-admin compatibility.
- Staff/admin MFA/AAL2 remains mandatory.
- Never edit existing Supabase migrations. Shared hosted schema changes are forward-only.
- Never weaken RLS, tests, authorization, staff MFA, security checks, upload sanitization or fail-closed behavior for automation convenience.
- Do not use hosted database reset, migration-history rewrite, destructive repair, or equivalent destructive recovery as normal remediation.
- The underlying perfume transaction remains off-platform.
- Payments, listing fees, subscriptions, boosts, ads, billing providers and other monetization paths remain disabled until their applicable business/legal/production gates authorize activation.
- Payment scaffolding is not activation authority.
- Merchant verification is a free trust status and is not sold.
- R0/R1 may auto-merge only after all required implementation, review, verification and CI gates pass.
- R2 may be implemented autonomously but must never merge without explicit H3 approval.
- R3 protected production, destructive or policy actions remain owner-controlled according to the current Human Gate rules.
- GitHub Issues are the canonical executable queue.
- Superpowers is the primary process owner; Matt and ECC/platform systems must not create competing workflows.
- Do not install, reinstall, vendor or replace skill systems merely because this historical setup plan names capabilities. Superpowers, Matt Pocock and ECC are already part of the intended Codex environment.
- Do not create, delete or replace agent/governance documentation blindly. Work from the repository files that actually exist.
- Do not perform unrelated feature work while reconciling or validating the autonomy operating model.
- Local, staging and production are isolated environments. Staging credentials do not grant production authority.
- Production mutations remain protected.
- Hosted Supabase mutations must use the repository's current target-locked tooling and current authorized target. Historical provider identifiers or credentials do not establish authority.
- Routine engineering history belongs in GitHub Issue + PR + CI. Do not create a per-task documentation journal unless repository policy specifically requires durable documentation.
- `docs/PROJECT-STATUS.md` remains a concise current snapshot rather than a chronological work log.
- Historical setup checkboxes below do not represent the current executable frontier. Current GitHub Issue state does.

---

# Task 1 — Establish the governance overlay

## Historical purpose

This task established the repository governance surfaces used by the autonomy model.

The files listed here now have independent authority according to their current contents. Do not recreate or replace them from this plan merely because this historical checklist is incomplete.

**Files originally involved:**

- Replace: `AGENTS.md`
- Create: `docs/agents/AUTONOMY.md`
- Create: `docs/agents/EXECUTION-LOOP.md`
- Create: `docs/agents/SKILL-ROUTER.md`
- Create: `docs/agents/HUMAN-GATES.md`
- Modify: `docs/agents/issue-tracker.md`
- Preserve: `docs/agents/domain.md`

**Interfaces:**

- Originally consumed: the approved autonomous-engineering operating-model design.
- Produced: repository-level governance subsequently used by engineering sessions.

## Historical validation steps

- [ ] **Step 1: Confirm the overlay files are present and review the scoped diff**

```bash
git status --short
git diff -- AGENTS.md docs/agents/
```

Expected for an isolated setup task: only governance/agent-document changes.

For current work, do not infer from this expectation that unrelated pre-existing repository changes may be deleted, reset, stashed or overwritten.

- [ ] **Step 2: Verify owner-interrupt-heavy rules are absent from current governance**

Historical check:

```bash
grep -n "Wait for instructions\|ask the owner whether to save\|Do not create branches, Git worktrees, commits, pull requests or pushes" AGENTS.md || true
```

Expected: current governance must not impose blanket owner approval for routine reversible engineering actions.

Current autonomy rules are defined by `AGENTS.md`, `docs/agents/AUTONOMY.md` and `docs/agents/HUMAN-GATES.md`, not by this grep alone.

- [ ] **Step 3: Verify safety boundaries are explicit**

```bash
grep -n "R2\|H3\|Never automatic\|Do not edit existing Supabase migrations" \
  AGENTS.md \
  docs/agents/AUTONOMY.md \
  docs/agents/HUMAN-GATES.md
```

Expected concepts:

- R0/R1 autonomous after required gates;
- R2 H3 before merge;
- R3 protected actions;
- migration immutability / forward-only hosted evolution;
- explicit Human Gate boundaries.

- [ ] **Step 4: Verify referenced governance/project files exist**

```bash
for f in \
  docs/MASTER-PLAN.md \
  docs/PROJECT-STATUS.md \
  docs/agents/AUTONOMY.md \
  docs/agents/EXECUTION-LOOP.md \
  docs/agents/SKILL-ROUTER.md \
  docs/agents/HUMAN-GATES.md \
  docs/agents/issue-tracker.md \
  docs/agents/domain.md; do
  test -f "$f" || { echo "missing: $f"; exit 1; }
done
```

Expected: exit 0.

- [ ] **Step 5: Historical scoped commit**

The original setup expected one scoped governance commit.

For current work, do **not** recreate this commit or recommit unchanged governance merely to satisfy this historical checkbox. Normal Git behavior follows the current issue and `AGENTS.md`.

---

# Task 2 — Bootstrap the GitHub executable queue vocabulary

## Historical purpose

This task established the machine-readable labels needed for deterministic autonomous issue selection.

**Reference:** `docs/agents/issue-tracker.md`

GitHub Issues are now the canonical executable queue; this plan is not a competing backlog.

## Historical validation steps

- [ ] **Step 1: Confirm GitHub target**

```bash
gh repo view --json nameWithOwner,url
```

Expected repository:

```text
todevan/perfume-marketplace-bg
```

If the target is different, stop before any GitHub mutation.

- [ ] **Step 2: Create/update the required label vocabulary**

Use the current exact label definitions in `docs/agents/issue-tracker.md`, not a stale copy from this plan.

The minimum conceptual vocabulary remains:

### Priority

```text
priority:P0
priority:P1
priority:P2
priority:P3
```

### Risk

```text
risk:R0
risk:R1
risk:R2
risk:R3
```

### Agent state

```text
agent:ready
agent:working
agent:review
agent:blocked
```

### Additional control labels

```text
human-gate
hosted-required
```

- [ ] **Step 3: Verify labels**

```bash
gh label list --limit 100 --json name --jq '.[].name' | sort
```

Expected to include the vocabulary defined by current `docs/agents/issue-tracker.md`.

- [ ] **Step 4: Record setup only if project state materially changed**

If queue capability or a blocker genuinely changes current project state, update `docs/PROJECT-STATUS.md` concisely.

Do not create documentation churn merely because a historical setup checklist was inspected.

- [ ] **Step 5: Commit only when tracked repository files actually changed**

Never create an empty commit to satisfy this historical plan.

---

# Task 3 — Validate unified capability routing

## Historical purpose

The original setup verified that the agent environment had enough process and specialist capability to execute the autonomy model truthfully.

Current rule: do not reinstall skills as part of this validation. Reconcile only actual routing/documentation mismatches.

**Reference:** `docs/agents/SKILL-ROUTER.md`

## 3.1 Process authority

Confirm the current environment can support the relevant Superpowers lifecycle, including as applicable:

```text
brainstorming
writing-plans
systematic-debugging
test-driven-development
using-git-worktrees
requesting-code-review
receiving-code-review
verification-before-completion
finishing-a-development-branch
subagent-driven-development or executing-plans
```

Expected:

- Superpowers remains the sole primary process framework.
- If two Superpowers execution modes exist, choose the one appropriate to the task; that is not a competing external process framework.
- Missing optional execution modes do not justify installing another planner/TDD/completion framework.

## 3.2 Matt deep-engineering layer

Confirm the currently available Matt Pocock capability names that are actually used by `SKILL-ROUTER.md`.

Primary expected deep-engineering capabilities include:

```text
diagnosing-bugs
domain-modeling
codebase-design
code-review
wizard
writing-for-agents
```

These are not process owners.

For example:

- `diagnosing-bugs` may deepen a Superpowers systematic-debugging investigation;
- `domain-modeling` may deepen feature/product modeling;
- `codebase-design` may deepen architectural design;
- `code-review` may provide a deep engineering review inside the repository review stage;
- `wizard` may help navigate a difficult engineering decision;
- `writing-for-agents` may improve durable agent-facing instructions.

Do not use Matt `tdd`, `implement`, or other potentially process-like capabilities as a second lifecycle when Superpowers already owns that step.

## 3.3 ECC / platform specialists

Confirm the relevant specialist capability is available before claiming it ran.

Examples include:

```text
security
backend
E2E / Playwright
evals
documentation lookup
Supabase
Cloudflare
GitHub integrations
```

Missing optional specialist integrations must be reported truthfully. Do not claim a specialist ran when it did not.

Do not install a new skill or integration merely to make this historical task read as complete.

## 3.4 Reconcile router names only when necessary

If the current environment exposes an equivalent capability under a different stable name, update `docs/agents/SKILL-ROUTER.md` only when that difference is real and materially affects routing.

Do not change the authority hierarchy:

```text
Repository truth
→ Superpowers process
→ Matt deep engineering when useful
→ ECC/platform specialist when useful
→ repository verification
```

## 3.5 Verify no competing process owner was introduced

Review the current router:

```bash
git diff -- docs/agents/SKILL-ROUTER.md
```

Expected conceptual outcome:

- one process owner;
- optional deep-engineering layer;
- optional specialist layer;
- no duplicate planner/debugger/TDD/execution/review/completion framework.

---

# Task 4 — Convert executable remediation work into GitHub Issues

## Historical purpose

This task migrated executable work from planning documents into the canonical queue.

**Reference material:**

- Historical remediation findings already transferred to the GitHub issue queue.
- `docs/superpowers/plans/2026-08-08-combined-remediation.md`
- `docs/agents/issue-tracker.md`

Current GitHub Issues, not this original conversion checklist, determine the executable frontier.

## Issue packet requirements

Each executable issue should contain enough information for autonomous execution, including:

- desired outcome;
- relevant context;
- acceptance criteria;
- verification;
- risk classification;
- dependencies;
- out-of-scope notes;
- `hosted-required` where hosted evidence is genuinely required;
- `human-gate` where a real unresolved owner/legal/business/product decision blocks execution.

## Historical issue families

The original setup expected issue families including:

```text
P0/R2 — auth data-requirement regression + lifecycle verification
P0/R2 — registration Turnstile abuse protection
P1/R1 — ListingWizard component tests
P1/R1 or R2 after inspection — bounded form-body parsing rollout
P2/R1 — listing-detail smoke coverage
P2/R1 — admin-page smoke coverage
P2/R2 — messaging/block/edit/delete/moderation semantics after H1 decision
P2/R2 — compatible deployment rollback model
P3/R1 — GitHub Actions immutable SHA pinning
P3/R0 — documentation reconciliation
```

These labels describe the original planning classification. Do not reopen already-completed work or recreate issues merely because they appear in this historical list.

Current issue risk may legitimately differ if the current implementation or scope differs.

## Preserve Human Gate decisions

Messaging/block/edit/delete/retention semantics remain a product/legal/security decision until resolved by the applicable H1/H2 Human Gate.

Do not use issue creation, Matt reasoning, ECC security analysis, or Superpowers planning to invent the product/legal decision.

Once the decision exists, subsequent implementation may proceed according to its current risk classification.

## Label discipline

Every executable issue should have:

- exactly one priority label;
- exactly one risk label;
- an agent-state label consistent with dependency state.

Use `agent:ready` only when dependencies and required prior Human Gates are satisfied.

## Ready frontier verification

```bash
gh issue list --state open --limit 100 --json number,title,labels
```

Expected conceptual result:

- deterministic ready work exists when the phase is executable;
- blocked work is visibly blocked;
- R2/R3 risk is explicit;
- hosted dependencies are explicit;
- the queue, not a planning document, represents what the agent may execute next.

---

# Task 5 — Validate the autonomous R1 lifecycle

## Historical purpose

This task was designed to prove that a normal R1 change could flow from ready issue to verified merge without routine owner interruption.

The original candidate was ListingWizard component-test coverage.

The exact issue used for any current validation may differ. Do not create duplicate ListingWizard work if current GitHub/source state shows it already exists or is no longer the right R1 validation issue.

## Required lifecycle property

For a current `risk:R1` issue:

```text
agent:ready
→ agent selects issue
→ isolated implementation
→ Superpowers lifecycle
→ applicable Matt/ECC specialist help
→ independent review
→ repository verification
→ CI
→ auto-merge when all gates pass
→ issue closure/reconciliation
→ select next ready issue
```

No Human Gate should be created for a reversible technical choice the engineering system can safely decide.

## Historical ListingWizard validation packet

If ListingWizard component coverage is still the selected current issue:

**Reference:**

- `src/lib/components/listing/ListingWizard.svelte`
- `tests/components/listing-card.test.ts`
- existing marketplace E2E tests.

Expected focused behaviors:

```text
step navigation/back
per-step validation
evidence-photo requirement for offer listings
Wanted-listing exception where current behavior requires it
draft/autosave-to-publish transition
server validation returning the user to the relevant step
```

Do not duplicate the full E2E suite.

## TDD discipline

For each behavior-changing slice:

```text
failing test
→ confirm expected RED
→ minimal coherent fix
→ confirm GREEN
→ relevant broader verification
```

If the issue is genuinely test-only and no production behavior changes, do not manufacture a production change just to exercise TDD.

## Verification

Use the current issue/risk-specific repository gates.

Typical R1 verification for this historical example included:

```bash
pnpm test:unit
pnpm check
pnpm build
```

Run affected E2E/browser checks when production behavior changed or when the issue acceptance criteria require them.

## Review

Use the repository's existing Superpowers review stage.

Matt `code-review` may provide deeper engineering review when useful.

ECC/platform specialists may review a specialist surface when useful.

Do not start an additional independent review workflow that competes with the repository execution loop.

## Merge behavior

When:

- issue is R0/R1;
- implementation is complete;
- required independent review is clean;
- required verification is fresh and green;
- CI is green;
- no Human Gate exists;

the change may auto-merge according to current `AGENTS.md` and `AUTONOMY.md`.

Routine owner approval is not required.

---

# Task 6 — Validate the R2 H3 boundary

## Historical purpose

This task was designed to prove that high-risk engineering can proceed autonomously while merge remains protected by H3.

The original suggested R2 examples were the auth data-requirement regression or registration Turnstile work. Those historical examples must not be reopened if current gate records already prove them complete.

Use a current genuine R2 issue if this validation is ever repeated.

## Required R2 lifecycle

```text
agent:ready / risk:R2
→ autonomous implementation begins
→ Superpowers process
→ Matt deep engineering where useful
→ ECC/security/platform specialist where useful
→ focused + broader verification
→ independent review
→ CI green
→ PR ready
→ H3 REQUIRED
→ merge only after explicit owner approval
```

R2 classification does **not** mean the owner must approve the start of ordinary implementation.

It means the merge boundary remains human-controlled.

## H3 presentation

Use the exact plain-language format required by `docs/agents/HUMAN-GATES.md`.

The owner should not have to read code to decide.

Present:

- what changed;
- why the change is considered high risk;
- verification/review evidence;
- remaining risk;
- recommended approve/reject choice.

## Rejection behavior

If H3 is rejected:

- do not merge;
- reconcile the stated concern;
- continue autonomously within the same authorized issue where possible;
- rerun affected review/verification;
- present H3 again only when there is materially new evidence.

Do not treat a rejection as permission to weaken tests/security or broaden scope.

## Acceptance property

An R2 change never merges solely because automation is green.

---

# Task 7 — Validate continuous autonomous continuation

## Historical purpose

This task tested whether the repository could support the owner command:

```text
Continue autonomous development according to AGENTS.md until the active phase is complete or you hit a human gate.
```

Current behavior should come from the repository's actual autonomy documents, not from this prompt template itself.

## Expected continuation behavior

A fresh engineering session should be able to:

1. read repository authority/current state;
2. determine the active phase/gate;
3. inspect the canonical GitHub Issues queue;
4. select the highest-priority ready issue consistent with dependencies;
5. classify/confirm risk;
6. execute autonomously;
7. reconcile the issue after completion;
8. select the next ready issue automatically.

The owner should not need to tell the agent which routine technical issue to do next.

## Documentation discipline

Expected:

```text
PROJECT-STATUS remains concise and current
MASTER-PLAN is not used as a work journal
ordinary task history lives in GitHub Issue + PR + CI
historical plans remain historical
durable docs change only when their actual authoritative state changes
```

## Stop conditions

Autonomous continuation may stop for:

- active phase/gate completion;
- H1 product decision;
- H2 legal/privacy/business decision;
- H3 R2 merge approval;
- H4/H5/H6 according to current Human Gate definitions;
- R3 protected production/policy/destructive action;
- exhausted repair budget / genuine technical blocker;
- explicit owner stop instruction.

Do not stop merely because:

- a reversible implementation detail has multiple technically valid answers;
- a test fails;
- CI fails once;
- code review raises an ordinary fixable engineering issue;
- a routine branch/commit/PR action is required.

Those belong to the autonomous engineering loop.

## Project-status update

Record autonomy capability in `docs/PROJECT-STATUS.md` only when it genuinely changes current project capability or limitation.

Do not repeatedly append setup history after every autonomous issue.

---

# Repair-budget behavior

The autonomy setup assumes bounded self-repair rather than either immediate owner interruption or infinite looping.

When implementation, tests, review or CI fail:

1. reproduce and identify the failing boundary;
2. use Superpowers systematic debugging;
3. use Matt `diagnosing-bugs` or relevant ECC/platform specialist when useful;
4. apply the smallest authorized repair;
5. rerun the affected verification;
6. continue while within the repository-defined repair budget.

Escalate only when:

- the repair budget is exhausted;
- the failure requires a Human Gate decision;
- current evidence requires an out-of-scope mutation;
- protected production/destructive/provider action is required;
- safe forward progress cannot be established.

Do not guess after the repair budget is exhausted.

---

# Named-gate scope discipline

Autonomy does not erase gate boundaries.

When work is authorized as a specific named gate or sub-gate, for example:

```text
A9 only
```

the agent may autonomously perform the engineering actions already authorized inside that exact boundary.

It may not infer permission for:

- prior/next gate mutations;
- unrelated provider configuration;
- unrelated Auth settings;
- schema changes outside the gate;
- synthetic account creation/elevation outside the gate;
- production work;
- destructive recovery.

If completing the gate requires an adjacent mutation not already authorized, stop at the applicable Human Gate/scope boundary and state the exact missing permission.

---

# Environment and hosted-target discipline

The autonomy operating model must preserve environment isolation.

## Local

Local development/testing may use local Supabase and repository-controlled fixtures.

Local success is not hosted evidence.

## Staging

Hosted staging mutations must use the current repository-defined target-locking procedures.

The authorized staging target is defined by the current operational docs. Historical project references must never be used merely because they appear in an old plan or shell history.

The repository's current staging verification command should be used before hosted DB mutation, for example:

```bash
pnpm db:staging:verify-target
```

Shared hosted migrations are forward-only.

## Production

Production is protected.

R3 production mutations require the owner involvement defined by current repository policy.

No staging credential, local test result, plan task, specialist skill, or historical provider receipt grants production authority.

---

# Current product/security invariants preserved by the autonomy model

The engineering automation must preserve, not reinterpret, the product.

## Normal users

- public email/password registration;
- email confirmation;
- no normal-user invite requirement;
- no phone/SMS OTP activation requirement.

## Staff/admin

- staff/admin MFA/AAL2 remains mandatory;
- moderator access remains case/report scoped where required;
- security-sensitive staff access must remain auditable.

## Marketplace transaction

- accepted offers/reservations/chat do not create platform checkout;
- the perfume transaction remains off-platform;
- both-party confirmation controls deal completion according to the product contract.

## Monetisation

- monetisation scaffolding is disabled until applicable business/legal/production gates;
- no autonomous engineering task may infer permission to enable billing;
- merchant verification remains a free trust status.

## Security/data

- RLS remains authoritative against hostile authenticated clients;
- service-role credentials do not belong in browser code;
- upload sanitization/evidence isolation remain fail-closed;
- secrets/PII must not be copied into normal issue/PR/task logs;
- existing migrations remain immutable.

---

# Final acceptance checklist

This historical setup plan considered the autonomy operating model successful when all of the following properties were demonstrated.

Current truth should be verified from the live repository and GitHub state rather than inferred from these checkboxes.

- [ ] A fresh agent determines the active phase without owner explanation.
- [ ] `Continue` is sufficient to begin the next normal ready issue.
- [ ] Reversible technical questions do not interrupt the owner.
- [ ] Superpowers is the single process authority.
- [ ] Matt Pocock skills are used only as deep-engineering support.
- [ ] ECC/platform skills are used only as specialist support.
- [ ] No competing planner/debugging/TDD/execution/review/completion framework is active.
- [ ] R0/R1 can pass review/verification/CI and auto-merge.
- [ ] R2 completes engineering but stops before merge for H3.
- [ ] R3 actions remain protected.
- [ ] Actual CI logs are inspected and ordinary failures are self-repaired within the repair budget.
- [ ] Security/DB/Cloudflare/UI/browser specialists route by change surface.
- [ ] Existing privacy/RLS/migration/product invariants remain intact.
- [ ] GitHub Issues represent dependencies and the executable frontier.
- [ ] `PROJECT-STATUS.md` remains concise.
- [ ] Historical plans/checkpoints do not masquerade as current state.
- [ ] The owner receives plain-language choices only at genuine Human Gates.
- [ ] Exhausted automation fails safely rather than guessing or looping forever.
- [ ] Named-gate mutation scope remains strict.
- [ ] Staging and production authority remain separate.
- [ ] The system continues issue-to-issue until active-phase completion or a real Human Gate.

---

# Reuse rule

Do not rerun this setup plan from Task 1 merely because a future agent discovers it.

Instead:

- read the current governance files;
- inspect the current GitHub queue;
- verify only the specific autonomy capability that appears broken or stale;
- fix the narrow authoritative source of that drift;
- collect fresh evidence;
- leave historical setup evidence historical.

If the current repository already satisfies an item, no action is required.

If this plan conflicts with the current repository authority model, the current repository authority wins.
If this plan conflicts with the current repository authority model, the current repository authority wins.
