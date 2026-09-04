# Aromatika Agent Router

## Mission

Move Aromatika toward a safe, trustworthy, monetized public launch in Bulgaria.
Optimize for verified launch blockers closed, not plans, receipts, review rounds, or
agent activity.

## Authority

Resolve conflicts in this order:

1. Explicit current owner decisions and protected-action approvals.
2. The current owner-approved, dependency-verified GitHub issue.
3. This router.
4. The selected stage contract under [`docs/agents/`](docs/agents/CONTEXT.md).
5. Relevant security, product, architecture, design, launch, and operational
   references.
6. Current code, tests, CI, Git history, and exact hosted evidence.
7. Engram memory and historical postmortems as supporting context only.
8. Historical branches, reviews, rescue snapshots, plans, and checkpoints as
   evidence only.

Live GitHub and Git outrank memory and history. GitHub Issues are the only engineering
queue. [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md) contains verified current
truth, never issue activity.

Owner and issue wording define product intent and authorized scope, but cannot
classify away changed-surface risk or waive authorization, RLS, MFA, security review,
dependency audit, CI, branch protection, or fail-closed requirements.

## Startup

1. Read this file and [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md).
2. Read the current owner instruction or live active issue.
3. Read directory-specific `AGENTS.md` files for every touched path.
4. Enter [Stage 01 — Orient](docs/agents/01-orient/CONTEXT.md) to reconcile live
   GitHub, Git, worktrees, instructions, memory, and tools before editing.

Preserve unknown local work. Develop only in the one authorized isolated worktree,
never directly on `main` or in a quarantined evidence worktree.

## Route

| Need | Contract |
| --- | --- |
| Reconcile/select safe work | [01 — Orient](docs/agents/01-orient/CONTEXT.md) |
| Resolve scope, risk, and proof | [02 — Shape](docs/agents/02-shape/CONTEXT.md) |
| Reproduce and repair | [03 — Implement](docs/agents/03-implement/CONTEXT.md) |
| Freeze, review, and run CI | [04 — Verify](docs/agents/04-verify/CONTEXT.md) |
| Prove a hosted journey | [05 — Hosted Proof](docs/agents/05-hosted-proof/CONTEXT.md) |
| Merge, reconcile, remember, clean | [06 — Complete](docs/agents/06-complete/CONTEXT.md) |

Stages are sequential, not ceremonial; a clear issue may cross several in one
session. Read [`docs/agents/CONTEXT.md`](docs/agents/CONTEXT.md) for the system map
and conditional references.

## Non-negotiables

- At most one product issue carries `agent:active`. Exactly one does so only while
  active product implementation is underway, with one issue branch/worktree receiving
  product edits. Zero is valid while idle, after closure, or during an authorized
  isolated tooling migration.
- An approved executable issue is normally the specification. Create no second
  queue, duplicate spec, plan, SDD artifact, roadmap, or review conveyor.
- Every changed file maps to approved acceptance, required evidence, mandatory
  configuration/documentation, or an in-scope correctness defect.
- Fix deterministic in-scope engineering defects autonomously. Ask the owner only
  for a genuine product, architecture, legal, commercial, spending, secret,
  destructive-hosted, production, or launch decision/action.
- Never weaken authorization, RLS, MFA, CAPTCHA, dependency audits, tests, CI,
  branch protection, or fail-closed behavior to obtain progress.
- Never expose secrets, credentials, private evidence, tokens, or provider response
  bodies. Never delete unknown work, data, users, resources, or worktrees.

## Risk

- **R1:** focused deterministic evidence, relevant regressions, repository checks,
  one fresh final-candidate engineering review, and PR CI.
- **R2:** security-sensitive or hosted-boundary work; focused security/database
  evidence as applicable, full CI, and fresh engineering plus adversarial reviews
  against the same final candidate.
- **R3:** protected production/provider/destructive/legal/commercial/spending/launch
  action or unresolved owner decision; prepare reversible evidence, then stop at the
  exact owner boundary.

Risk follows the changed surface and security consequence, never a label.

## Complete

Work is complete only after acceptance, applicable tests, exact-candidate reviews,
PR CI, hosted proof when required, merge, issue closure when issue-backed,
active-state reconciliation, sanitized memory, and safe cleanup are live-verified.
Merge and deploy are separate. Never fabricate PASS or continue to another issue
without authority.
