# Aromatika Engineering Conveyor

## Purpose

Use one issue-driven lifecycle:

owner-approved and dependency-verified issue → agent:active → isolated
implementation → deterministic verification → one consolidated risk gate → pull
request and CI → merge and issue closure → live GitHub progress report → next
verified issue

GitHub Issues are the sole engineering queue. The active issue is the executable
specification. Code/tests prove implementation, CI proves the candidate, the pull
request records scope and review, and docs/PROJECT-STATUS.md records only verified
system truth.

## Executable issue contract

An issue enters the conveyor only when all are true:

- it is open;
- owner approval is recorded through an explicit owner comment/instruction or an
  owner-authored executable issue;
- outcome, acceptance criteria, scope, and exclusions are clear;
- dependencies are identified and verified from live GitHub/repository state;
- risk and required verification are defined;
- no product, architecture, legal, commercial, or protected-action decision is
  unresolved;
- any R3 owner action is identified.

The issue may be clarified without changing product intent. Missing decisions return
to the owner as one exact question. agent:ready, issue order, previous handoffs,
historical plans, and labels never prove that dependencies remain resolved.

Risk is derived from the changed surface and security consequence. Issue wording,
labels, and agent edits cannot downgrade an R2/R3 surface or waive a mandatory gate.
Preserve owner-authored approval/decision text; put agent clarifications in additive
comments. Before implementation and again before final review/merge, re-read the
live body, approval evidence, update time, dependencies, and exclusions. A material
change requires renewed owner approval.

Approval covers only decisions written in the issue. It never covers scope expansion,
new product behavior, newly discovered architecture decisions, or protected R3
operations.

## Live selection

When the owner says “Continue Aromatika”:

1. read live issues, pull requests, CI, branches, worktrees, and Git state;
2. reconcile every agent:active label against reality;
3. remove stale active state from closed, merged, superseded, or blocked work;
4. continue the active issue only when it remains eligible and unblocked;
5. otherwise inspect approved launch issues and verify their current dependencies;
6. select the highest-priority currently unblocked issue;
7. apply agent:active before implementation;
8. create or reuse its single branch and active worktree.

Use priority, current dependency truth, security consequence, and launch-path impact.
Do not encode a permanent next issue number in repository instructions.

The authoritative launch set is the existing GitHub query:

is:issue label:launch-readiness

## Single active state and recovery

Exactly one issue carries agent:active. Exactly one issue branch and one issue
worktree receive active edits.

Before creating work, reconcile:

- the active label and issue state;
- open/merged pull requests and CI;
- local and remote branches;
- existing worktrees;
- candidate SHA and merge state.

Reuse valid interrupted state. Dormant branches may preserve blocked/interrupted work
but receive no edits while another issue is active. Never delete unknown work,
hard-reset to remote, or create a second active issue to escape stale state.

Quarantined evidence uses an unmistakable quarantine/archive branch name and a
worktree lock reason when retained locally. It is never an active startup or
implementation location. If a session opens there, make no tracked edits: inspect
only what is needed to reconcile live state, then create/reuse the single active
issue worktree from fetched main and verify its effective project configuration.
Preserving historical untracked artifacts takes precedence over moving that
worktree merely for cosmetic isolation.

Use branch names of the form codex/issue-N-short-outcome. Create worktrees under the
user home/project parent where CodeGraph can maintain an independent .codegraph
index. Fetch origin before branching, compare with origin/main, and reconcile Remote
ahead or Diverged before edits.

## Superpowers and model routing

Superpowers supplies TDD, systematic debugging, isolated worktrees, deterministic
verification, engineering review, adversarial security review, and completion
verification inside this lifecycle.

For an approved issue, the issue is prior design approval. Do not create a duplicate
design, implementation plan, SDD artifact, approval loop, receipt ledger, or roadmap.
A separate design artifact requires an explicit owner request or a newly discovered
architecture decision affecting multiple issues that cannot safely be resolved in
the issue.

Model discipline:

- default reasoning: high;
- xhigh: only demonstrated R2 uncertainty, conflicting evidence, or unresolved
  high-consequence review disagreement;
- mechanical exploration/edits: cheapest reliable capability;
- security, architecture, database, payment, and final R2 judgments: strong lead;
- required reviews: fresh context independent from the implementer;
- delegation: bounded, independent work only, with minimum sufficient context;
- retries: deterministic evidence before escalation.

One task owner remains accountable. More agent activity is not progress.

## Scope and defect triage

Every changed tracked file maps in the pull request to one of:

- an acceptance criterion;
- a required test;
- a mandatory configuration change;
- a required documentation update;
- an in-scope defect necessary for acceptance or correctness of a directly modified
  path.

Classify discoveries:

- Directly required defect: fix in the active issue with a regression test.
- Unrelated non-P0 defect: create/update a separate issue and continue.
- P0 security/data-loss defect: interrupt through the P0 procedure.
- Enhancement, cleanup, or speculative improvement: reject as out of scope.

Being in the same module is not sufficient. Create a reusable orchestration layer or
broad abstraction only after two current approved issues demonstrate the same
requirement.

## Implementation and evidence

For behavior changes:

1. reproduce the discrepancy;
2. add the smallest deterministic failing test;
3. observe the intended failure;
4. implement the minimum correct change;
5. observe focused green;
6. run affected regressions and the issue-required gates.

For documentation/configuration, use deterministic authority, contradiction,
reference, parser, and effective-configuration checks. Do not create fake code tests
or receipt files.

The pull request explains every changed file, lists exclusions, names the exact
candidate SHA, links the issue, and contains Closes #N. Technical evidence remains
secondary to the launch outcome.

## Risk gates

Classify risk before implementation.

### R1

Against the candidate:

- focused deterministic tests;
- relevant regression tests;
- repository checks;
- one fresh engineering review;
- pull-request CI.

### R2

Against the same candidate commit:

- focused deterministic security tests;
- relevant database and contract tests;
- full repository CI;
- one fresh independent engineering review;
- one fresh independent adversarial security review.

R2 has one consolidated review stage containing both reviews. It has no intermediate
receipt loop.

### R3

Prepare safe, reversible local work and rollback evidence. Stop before production
deployment/provider mutation, production secret/data change, destructive hosted
operation, billing/commercial/legal acceptance, meaningful spend, final launch, or
an unresolved product/architecture decision. Report one exact owner action.

### Repair-pass limit

A repair pass batches all verified blocking findings against one exact candidate
commit. Allow at most two evidence-driven repair passes.

After the second pass, unresolved blockers are not waived: mark the issue blocked,
record the exact engineering/security/architecture decision, remove agent:active,
and ask only for the decision required to unblock it.

A changed SHA invalidates approvals for changed surfaces and affected findings.
Focused re-review is sufficient unless the risk surface materially changed.
After every SHA change, each required reviewer must explicitly attest the final
candidate SHA. Focused scope may reuse analysis of unchanged surfaces, but an
approval bound only to an earlier SHA never authorizes merge.

## P0 interruption

For a P0 security or data-loss defect:

1. stop modifying the current issue;
2. reach a deterministic, non-secret checkpoint;
3. preserve the interrupted branch safely;
4. push only tracked changes safe for remote storage;
5. record the interruption and remaining blocker in the issue;
6. remove agent:active from the interrupted issue;
7. create or identify the dedicated P0 issue;
8. apply agent:active to the P0 issue;
9. work only on the P0 issue until resolved or owner-blocked.

After closure, rerun live selection. The interrupted issue resumes only if it remains
the next eligible issue.

## Merge, closure, and handoff

Never bypass required checks, force-push main, weaken protections, or merge an R2
candidate without both fresh reviews and deterministic evidence. Merge and deploy
are separate.

After CI passes:

1. merge through the protected main rail;
2. verify the merge and issue closure from live GitHub;
3. remove/reconcile agent:active;
4. update docs/PROJECT-STATUS.md only when verified system truth changed;
5. fetch and compare the local workspace;
6. report live progress;
7. rerun selection for the next issue.

Every handoff reports:

- Launch progress: closed / total from is:issue label:launch-readiness
- Active issue: #N or none
- Blocked issues: numbers and exact blockers
- Next verified-unblocked issue: #N or none
- Owner action: exact protected action or none
- PR, candidate SHA, tests, reviews, and CI as supporting evidence

If execution stops, preserve the working system and state the exact stop condition.
