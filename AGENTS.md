# AGENTS.md

## Mission

Move Aromatika toward a safe, trustworthy, monetized public launch in Bulgaria.
Optimize for verified launch blockers closed, not plans, commits, receipts, review
rounds, or agent activity.

The owner makes product, business, legal, commercial, and protected real-world
decisions. Agents own implementation, engineering review, verification, repair,
routine Git/GitHub mechanics, and safe continuation.

## Authority

Apply authority in this order:

1. explicit owner decisions and protected-action approvals;
2. the owner-approved, dependency-verified, active GitHub issue;
3. this file and docs/agents/WORKFLOW.md;
4. current code, tests, CI, Git history, hosted evidence, and the relevant product,
   design, architecture, security, launch, and business documents;
5. historical specifications, reviews, plans, branches, and receipts.

GitHub Issues are the only engineering queue and progress tracker. An approved issue
is the executable specification and prior design approval. It authorizes only its
explicit decisions and never authorizes an undeclared feature, architecture decision,
or protected R3 action.

Historical artifacts and quarantined branches are evidence only. They do not govern
current implementation.

docs/PROJECT-STATUS.md records verified product, deployment, hosted-system, and
operational truth only. It does not track tasks, issues, branches, percentages, or
agent activity.

## Startup router

At session start read:

1. AGENTS.md;
2. docs/PROJECT-STATUS.md;
3. the active issue or current owner instruction;
4. directory-specific AGENTS.md files for touched paths.

For substantial work read docs/agents/WORKFLOW.md. For R2/R3 work also read
docs/agents/SECURITY.md. Load PRODUCT.md, DESIGN.md, docs/ARCHITECTURE.md,
docs/LAUNCH-GATES.md, or docs/BUSINESS-MODEL.md only when the issue touches that
concern.

Before editing, fetch and reconcile live GitHub, Git, PR, CI, label, branch, and
worktree state. Preserve unknown local work. Never develop directly on main.

When the owner says “Continue Aromatika”, follow the live-selection procedure in
docs/agents/WORKFLOW.md. Do not select work from issue order, stale labels, old
handoffs, historical roadmaps, or status-document percentages.

## Issue eligibility and active state

An issue is executable only when owner approval is recorded, its outcome and
testable acceptance criteria are clear, scope and exclusions are explicit,
dependencies are live-verified, risk and verification are defined, and no product,
architecture, legal, or protected-action decision remains unresolved.

Exactly one issue carries agent:active. Exactly one branch and one issue worktree
receive active implementation edits. Reconcile stale active state before creating
either.

If a missing decision cannot be derived from current evidence, return one exact
question to the owner. Otherwise continue autonomously.

## Scope control

Every changed tracked file must map to an acceptance criterion, required test,
mandatory configuration or documentation update, or an in-scope defect required for
the active path. Record that mapping in the pull request.

Fix a discovered defect inside the issue only when it is required for acceptance or
for the security/functional correctness of a directly modified path. File unrelated
non-P0 defects as separate issues. Interrupt for P0 security or data-loss defects
using docs/agents/WORKFLOW.md. Reject enhancements, cleanup, and speculative work.

Create a broad abstraction only after two current approved issues prove the same
concrete requirement.

## Risk router

### R1 — standard product change

Focused deterministic tests, relevant regressions, repository checks, one fresh
engineering review, and PR CI.

### R2 — security-sensitive or hosted-boundary change

Includes authorization, privacy, data integrity, moderation, payment/entitlement,
destructive-operation safeguards, secrets/security configuration, and hosted
boundaries. Require focused security tests, relevant database/contracts, full CI,
one fresh independent engineering review, and one fresh adversarial security review
against the same candidate commit.

### R3 — protected owner action or unresolved decision

Includes production deployment/provider mutation, production secrets or data,
destructive hosted operations, billing/commercial/legal acceptance, meaningful
spend, final launch, and unresolved product or architecture decisions. Agents may
prepare reversible evidence but stop before the protected operation and report one
exact owner action.

Never weaken security controls, tests, branch protection, authorization, RLS, MFA,
or CI to obtain progress. Never expose service-role or secret credentials.

## Engineering process

Superpowers remains enabled inside the GitHub issue lifecycle for TDD, debugging,
worktrees, deterministic verification, engineering review, security review, and
completion checks. It does not create duplicate specifications, implementation-plan
documents, SDD artifacts, receipt ledgers, roadmaps, or approval loops for an
already-approved issue.

Default project reasoning is high. Use xhigh only for demonstrated R2 uncertainty.
Use deterministic tools before another model opinion and keep delegation bounded.
Detailed model routing, repair limits, P0 handling, and merge rules live in
docs/agents/WORKFLOW.md.

## Completion and handoff

A task is complete only after acceptance criteria, applicable tests/checks, required
reviews, exact-candidate evidence, PR CI, merge, issue closure, and active-state
reconciliation succeed. Merge and deploy are separate. Never fabricate a PASS.

Every completed or blocked handoff reports:

- Launch progress: closed / total issues from the canonical launch-readiness query
- Active issue: #N or none
- Blocked issues: issue numbers and exact blockers
- Next verified-unblocked issue: #N or none
- Owner action: exact protected action or none
- Technical evidence: PR, candidate SHA, tests, reviews, and CI

Then include:

### What changed
User-facing, business, or safety outcome.

### Your action
Use exactly “Your action: none.” or “Your action now:” followed by exact sequential
instructions.

### Sync status
Use exactly one: Synchronized, Local ahead, Remote ahead, or Diverged.

### Next autonomous steps
State only already-authorized continuation.

### Stop condition
State the missing evidence or decision and preserve the working system.
