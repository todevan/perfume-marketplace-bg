# Autonomous Engineering Operating Model — Design Specification

> **Status:** OWNER-APPROVED DESIGN BASELINE. The operating model has since been implemented through `AGENTS.md` and `docs/agents/`; those current repository files govern execution.
>
> **Original design date:** 2026-08-08
>
> **Execution-model reconciliation:** 2026-08-11
>
> **Project:** Bulgarian perfume marketplace — SvelteKit + TypeScript + Supabase + Cloudflare

## 1. Purpose

This specification defines the intended operating model for the repository as an
**autonomous engineering system** for a non-programmer owner.

The desired owner experience is intentionally simple:

> **“Continue autonomous development.”**

The engineering system should then determine the next ready task, plan it when
necessary, implement it, test it, review it, repair ordinary failures, create
and merge eligible pull requests, reconcile project state, and continue until it
either completes the active phase or reaches a genuine Human Gate.

The owner is **not** expected to:

- review implementation details;
- choose libraries;
- decide ordinary file boundaries;
- understand Git;
- debug tests;
- interpret CI logs;
- make reversible technical decisions that repository evidence can safely
  resolve.

When owner involvement is genuinely required, agents translate the decision or
risk into plain language first. Technical detail remains available on request.

This operating model changes engineering workflow and repository governance
only.

It does **not** by itself change:

- marketplace product behavior;
- legal or privacy policy;
- payment/monetisation scope;
- launch gates;
- production authority;
- authentication/product decisions;
- named-gate mutation scope.

## 1.1 Role of this document

This is the owner-approved **design baseline** for the autonomy model.

It is not the current executable queue and is not a second execution framework.

Current execution authority lives in the repository's implemented governance,
especially:

```text
AGENTS.md
docs/agents/AUTONOMY.md
docs/agents/EXECUTION-LOOP.md
docs/agents/SKILL-ROUTER.md
docs/agents/HUMAN-GATES.md
docs/agents/issue-tracker.md
```

Where this dated design describes setup work that has since been implemented,
future agents should inspect the current repository rather than repeating the
setup from this specification.

Historical examples and proposed labels/capabilities below should not override
the current implemented governance vocabulary.

---

## 2. Design principles

### 2.1 Autonomous by default

Any reversible engineering decision that can be resolved safely from:

- repository conventions;
- tests;
- authoritative project documentation;
- current issue/gate scope;
- official technical documentation;
- established code patterns;

is delegated to the engineering agent.

Agents should not interrupt the owner for ordinary choices such as:

- helper/function names;
- which established repository pattern to reuse;
- where a test belongs;
- whether a narrow private helper should be extracted;
- ordinary dependency-free refactoring necessary to implement a task safely;
- how to fix type errors, lint errors, test failures, or ordinary CI failures;
- whether to add a regression test for a discovered bug;
- whether to update current engineering documentation that became factually
  stale because of the task.

Autonomy is bounded by:

- the current GitHub Issue;
- explicit named-gate scope;
- `R0`–`R3` risk;
- H1–H6 Human Gates;
- environment authority;
- repository security/product invariants.

A properly scoped task does not authorize adjacent mutations.

For example:

```text
A9 only
```

means only A9-scoped work is authorized. It does not imply permission for A8,
A10, unrelated provider settings, unrelated database changes, or production.

### 2.2 Human approval at high-risk boundaries

High-risk engineering changes may be:

- researched;
- diagnosed;
- designed;
- implemented;
- tested;
- independently reviewed;
- pushed;
- prepared as a pull request;

autonomously.

They **must not be merged** until the applicable H3 high-risk merge approval is
received.

The owner reviews intended behavior and risk, not raw code unless they explicitly
request technical detail.

### 2.3 Humans own product, legal, business and protected production decisions

Agents must not invent policy where correctness depends on:

- marketplace owner intent;
- legal advice;
- privacy commitments;
- business strategy;
- monetisation policy;
- moderation/product semantics;
- protected production actions;
- irreversible or destructive decisions.

Those boundaries use the applicable H1–H6 Human Gate.

### 2.4 Evidence before completion

No agent may claim that work is:

- complete;
- fixed;
- safe;
- passing;
- deployable;
- production-ready;

based on reasoning alone.

Completion claims require fresh verification evidence appropriate to the task
and risk level.

Historical PASS evidence does not automatically prove a later candidate.

Likewise, a historical BLOCKED result does not automatically prove the blocker
still exists after later verified work.

### 2.5 One process owner, layered engineering expertise

**Superpowers is the primary process framework.**

It governs how non-trivial work is:

- explored;
- planned;
- diagnosed;
- implemented;
- tested;
- reviewed;
- verified;
- completed.

**Matt Pocock skills are the deep-engineering layer.**

They may deepen the current Superpowers step for diagnosis, modeling, design,
review or agent-facing communication.

Relevant examples include:

```text
diagnosing-bugs
domain-modeling
codebase-design
code-review
wizard
writing-for-agents
```

**ECC and platform capabilities are specialists.**

They provide focused expertise for surfaces such as:

```text
security
backend
Supabase
Cloudflare
E2E / Playwright
GitHub integrations
evals
documentation lookup
```

Matt and ECC/platform systems do not create a second lifecycle.

Do not run:

- a second planner;
- a competing debugging methodology;
- a second TDD loop;
- a competing implementation framework;
- a duplicate review workflow;
- a second completion loop.

Skills are engineering tools, not independent sources of project truth.

### 2.6 Small, reversible changes

Autonomy does not mean giant diffs.

Prefer:

- small vertical slices;
- focused regression tests;
- forward-only migrations;
- reviewable commits/PRs;
- explicit compatibility boundaries;
- reversible non-production engineering actions;
- independent review.

### 2.7 Repository state is the memory

Durable project memory lives in:

- `AGENTS.md`;
- authoritative project docs;
- current status/gate docs;
- GitHub Issues;
- pull requests;
- tests;
- CI;
- durable release/security evidence where required.

No single chat session is trusted as the only source of project state.

Historical audits, plans, manifests and task records remain evidence of their
recorded checkpoints rather than current authority.

---

## 3. Authority hierarchy

When current engineering instructions or evidence conflict, use this project
authority model:

1. **Explicit current owner instructions**
2. **Repository instructions / root `AGENTS.md`**
3. **Authoritative current product, phase and status documents**
4. **Architecture, launch, security and operational documents, including repository-defined verification and release gates**
5. **Applicable `docs/agents/` policy**
6. **Canonical GitHub Issue and explicitly authorized named-gate scope**
7. **Superpowers process**
8. **Matt Pocock deep-engineering skills when useful**
9. **ECC/platform specialist capabilities when useful**
10. **External/global generic defaults**

Repository-defined verification and release gates bind every skill layer below
them.

An explicit owner decision that changes product, policy, risk authority or scope
should be recorded into the appropriate authoritative repository surface rather
than existing only in chat.

Historical audits, old task reports, old planning checklists and old provider
receipts are evidence, not authority over current code or project state.

---

## 4. Risk model

Every executable engineering issue must have a current risk classification
before merge authority is determined.

Priority and risk are separate.

For example:

```text
priority:P0
risk:R2
```

means an urgent high-risk engineering issue.

### R0 — Trivial / documentation

Examples:

- typo or copy correction that does not alter policy;
- current engineering documentation reconciliation;
- test-description cleanup;
- formatting-only changes;
- comment/JSDoc correction.

**Autonomy:** fully autonomous.

**Merge:** may auto-merge after the narrow appropriate checks.

### R1 — Normal engineering

Examples:

- ordinary UI improvements that preserve existing security/product semantics;
- component tests;
- non-security bug fixes;
- accessibility fixes;
- small server-side behavior using existing authorization boundaries;
- safe refactoring covered by tests;
- performance improvements without privacy/auth effects.

**Autonomy:** fully autonomous.

**Merge:** may auto-merge after required verification, independent review and CI
pass.

### R2 — High-risk engineering

R2 is the mandatory H3 pre-merge review class.

A change is normally R2 when it materially touches or changes areas such as:

- authentication;
- sessions;
- login;
- registration;
- password recovery;
- MFA;
- user admission/onboarding activation;
- membership authorization;
- Supabase RLS or authorization predicates;
- `SECURITY DEFINER` functions;
- service-role or privileged database usage;
- admin/staff/moderator permissions;
- privacy boundaries;
- cross-user visibility;
- private Storage access;
- listing/report evidence security;
- account deletion/anonymization/retention/export;
- blocking/reporting/moderation/evidence behavior;
- secrets or security-sensitive runtime configuration;
- migrations affecting existing data/ownership/auth/privacy/invariants;
- deployment/rollback changes affecting compatibility or material availability;
- email/webhook behavior where duplication or disclosure has material
  consequences;
- changes where failure could expose one user's confidential data to another;
- work explicitly classified `risk:R2` by current repository authority.

**Autonomy:** implementation and verification proceed autonomously.

**Merge:** **must wait for H3 owner approval.**

### R3 — Protected production / policy / destructive boundary

R3 is the protected human-action class.

Examples include:

- production database migrations;
- destructive production database operations;
- production-data deletion;
- production-secret rotation/revelation;
- protected production DNS/infrastructure changes;
- enabling billing/payments/monetisation;
- changing legal/privacy/retention policy;
- material owner-level moderation/product policy;
- bulk customer email/SMS;
- destructive infrastructure action;
- irreversible or materially consequential production-provider mutations.

**Autonomy:** agents may prepare:

- diagnosis;
- implementation;
- scripts;
- dry-runs;
- target verification;
- backup/recovery plans;
- wizard instructions;
- post-action verification.

**Protected execution:** requires the current owner/Human Gate authority.

### 4.1 Environment is not a substitute for risk/scope

“Staging” does not mean “automatically authorized.”

Non-production mutations still require:

- the correct current issue/gate;
- exact target identification;
- named-gate scope;
- current risk routing;
- target-locking where required.

Production remains separately protected.

---

## 5. Human Gates

Agents stop only when one of the current H1–H6 boundaries is genuinely reached.

The canonical wording/templates live in:

```text
docs/agents/HUMAN-GATES.md
```

This specification preserves their design intent.

### H1 — Product behavior decision

Use when several technically valid choices create meaningfully different user
behavior and authoritative product docs do not decide between them.

Examples:

- semantics of blocking another user;
- message edit/delete behavior;
- visibility of completed listings;
- interaction while a moderation case is open.

The agent should:

- ask one plain-language question;
- recommend one option;
- provide at most two genuinely distinct alternatives;
- explain consequences.

Do not ask implementation-detail questions that engineering evidence can decide.

### H2 — Legal / privacy / business decision

Use when correctness depends on:

- legal policy;
- privacy policy;
- retention;
- business model;
- monetisation;
- owner/company identity;
- merchant policy;
- authenticity/legal wording;
- public indexing or similar non-technical decisions.

Agents must not fabricate legal certainty.

### H3 — High-risk merge approval

Use only **after** R2 engineering is fully implemented and verified.

Do not ask the owner to approve the start of ordinary R2 implementation merely
because it is high risk.

The gate protects the merge.

### H4 — Production / credential / protected provider action

Use when production credentials/configuration or other protected external state
requires owner involvement under current repository policy.

Use the current owner-facing wizard/instruction mechanism where helpful.

### H5 — Destructive or irreversible operation

Examples:

- dropping protected production tables;
- deleting production user data;
- destructive production Storage deletion;
- force-pushing protected shared history;
- destroying production infrastructure.

A green test suite cannot bypass H5.

### H6 — Automation exhausted

Use only after the repository's repair budget is genuinely exhausted.

The current repair budgets live in `docs/agents/EXECUTION-LOOP.md`.

The original default design was:

- focused implementation/test failure: 3 materially different repair attempts;
- CI failure: 3 materially different root-cause repair attempts;
- serious review loop: 3 review/fix cycles;
- deployment/staging verification: 2 materially different repair attempts where
  external-state ambiguity remains.

Repeating the same unsuccessful edit with cosmetic variation does not count as a
new attempt.

---

## 6. High-risk owner review contract

When an R2 PR reaches H3, the owner should receive only the information needed
to make a risk decision.

Canonical formatting belongs in `docs/agents/HUMAN-GATES.md`.

The intended shape is:

```text
HIGH-RISK CHANGE READY FOR REVIEW

Issue: #123 — Enforce recipient-side message blocking

What changed:
Blocked users can no longer send new messages to the person who blocked them.
Historical completed-deal conversation records are retained.

Why this change exists:
The previous database invariant checked the sender's own block state rather than whether the recipient had blocked that sender.

What could go wrong if this change is wrong:
Users could be prevented from legitimate contact, or a blocked user could retain a path to message another user.

Security/data impact:
Database authorization behavior changes. No new public data exposure is intended.

Verification completed:
✓ focused unit/contract tests
✓ pgTAP/RLS tests
✓ migration-from-scratch if applicable
✓ Svelte/TypeScript check
✓ production build
✓ relevant Playwright/browser flow
✓ specialist security review
✓ independent code review
✓ GitHub CI

Unresolved findings:
None.

Recommended decision:
APPROVE MERGE

Owner choices:
1. Approve merge
2. Reject / send back for revision
3. Explain this in simpler terms
4. Show me the technical details
```

The default owner view must not require reading code.

---

## 7. Autonomous permissions

### 7.1 Automatically allowed engineering actions

Within the current issue/gate scope, agents may normally perform the following
without owner interruption:

- read/search the repository;
- read authoritative project documentation;
- inspect Git history/diffs;
- consult official technical documentation;
- use current specialist tooling;
- create/update GitHub Issues;
- apply current issue labels/dependency state;
- create isolated branches/worktrees;
- modify non-production source code;
- create tests;
- create new forward-only migrations locally;
- run local database/test workflows;
- run component/contract/unit/E2E tests;
- run typecheck/build/lint/security checks;
- create scoped commits;
- push feature branches;
- open/update PRs;
- inspect and repair ordinary CI failures;
- respond to technically valid review findings;
- update current engineering documentation when verified behavior changed;
- close completed issues after merge;
- clean completed branches/worktrees according to repository policy;
- auto-merge eligible R0/R1 PRs.

Autonomy does not grant permission to:

- discard unknown work;
- rewrite protected history;
- silently broaden issue scope;
- perform adjacent named-gate mutations.

### 7.2 Non-production hosted actions

Non-production hosted actions are **not globally automatic merely because the
target is staging**.

They may proceed only when the current repository issue/gate explicitly makes
the action executable and all applicable target/risk controls are satisfied.

Examples that may be autonomous **inside an already authorized exact
non-production scope** include:

- apply the exact authorized staging forward migration set;
- provision explicitly synthetic staging fixtures;
- execute staging browser tests;
- deploy an exact approved staging candidate;
- run scoped hostile test fixtures;
- clean synthetic staging state.

Requirements include, where applicable:

- exact authorized environment;
- target-locked verification;
- synthetic data only;
- no production credentials;
- no real-user mutation;
- forward-only database posture;
- named-gate scope discipline;
- durable sanitized evidence;
- proven cleanup.

An instruction such as `A9 only` does not authorize deployment, migration,
provider configuration or hostile A10 execution.

### 7.3 Never automatic

Never automatic:

- merge R2 without H3;
- perform R3 protected action without required owner authority;
- weaken tests/security merely to obtain green CI;
- edit an existing Supabase migration;
- bypass RLS/service boundaries for convenience;
- expose private user data or secrets in logs/issues/PRs/docs/prompts;
- enable payments/boosts/ads/subscriptions/other monetisation outside approved
  gates;
- change product/legal/privacy decisions silently;
- rewrite protected Git history;
- discard unknown owner work;
- treat staging credentials as production authority;
- use a historical provider/SHA/migration receipt as current truth without
  verification.

---

## 8. Session-start behavior

The owner-interrupt-heavy rule:

```text
read status → state blockers → wait for instructions
```

is not the intended normal workflow.

A normal autonomous session should:

1. read root `AGENTS.md`;
2. read the required current authoritative state documents defined there;
3. inspect current Git/worktree state;
4. inspect the GitHub ready frontier;
5. reconcile obvious stale issue state against merged/current code;
6. determine the active phase or named gate;
7. select the highest-priority executable issue;
8. confirm current risk;
9. begin automatically unless a Human Gate or scope blocker is already known.

The agent should provide a concise progress update, not ask permission to begin
ordinary ready work.

### Standard owner command

The intended one-line command is:

> **Continue autonomous development according to AGENTS.md until you hit a human gate or finish the active phase.**

Short forms such as:

```text
continue
next
keep going
resume
```

should have the same interpretation when context is clear.

---

## 9. GitHub Issues as the executable queue

GitHub Issues are the canonical executable engineering queue.

Historical plans/specs are not competing queues.

## 9.1 Required current label vocabulary

The implemented autonomy model uses the vocabulary defined in:

```text
docs/agents/issue-tracker.md
```

The required concepts include:

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

### Control

```text
human-gate
hosted-required
```

Older proposed triage names such as:

```text
needs-triage
needs-info
ready-for-agent
ready-for-human
```

are historical design possibilities and should not compete with the current
implemented vocabulary unless current `issue-tracker.md` explicitly retains
them.

Avoid unnecessary label proliferation.

## 9.2 Selection algorithm

The current executable frontier should be selected deterministically.

Conceptually:

1. issue belongs to the active phase/gate or is a higher-priority blocker;
2. issue is executable now;
3. dependencies are resolved;
4. no unresolved Human Gate blocks it;
5. highest priority first;
6. security/correctness before cosmetic work at equal priority;
7. deterministic tie-breaker;
8. respect named-gate mutation scope.

A lower-priority issue must not be selected merely because it is easier if a
higher-priority executable blocker exists.

## 9.3 Ticket quality

Agent-ready issues should describe:

- outcome;
- context;
- acceptance criteria;
- verification;
- risk;
- dependencies;
- out-of-scope boundaries.

They should not micromanage implementation details unnecessarily.

Use the current ticket-generation capability only after the underlying product
or technical direction is sufficiently decided.

## 9.4 Historical remediation-plan conversion

The 2026-08-08 combined remediation plan was intended to be decomposed into
vertical GitHub Issues rather than implemented as one giant change.

That is historical setup intent.

Current issue state determines which of those tasks remain relevant.

Do not recreate completed auth/Turnstile/Gate work merely because this spec
originally listed it as upcoming work.

---

## 10. Skill routing

The implemented deterministic router lives in:

```text
docs/agents/SKILL-ROUTER.md
```

This section preserves the architectural design.

### 10.1 Primary process — Superpowers

Use Superpowers for the engineering lifecycle, including as applicable:

- brainstorming;
- writing plans;
- systematic debugging;
- test-driven development;
- isolated worktrees;
- plan execution;
- requesting/receiving code review;
- verification before completion;
- branch completion.

If an approved specification/plan already exists, do not create a duplicate
spec merely because a generic workflow normally starts with planning.

Technical questions that can safely be resolved from evidence are delegated to
the agent.

Brainstorming interrupts only when a genuine Human Gate is reached.

### 10.2 Bug investigation

Primary:

```text
Superpowers systematic-debugging
```

Deep-engineering support when useful:

```text
Matt diagnosing-bugs
```

Typical flow:

```text
reproduce
→ isolate failing boundary
→ determine root cause
→ regression test
→ minimal coherent fix
→ focused verification
→ broader verification
```

Do not create an independent Matt debugging/implementation lifecycle.

### 10.3 Test-driven implementation

Primary:

```text
Superpowers test-driven-development
```

Use framework/domain-specific testing knowledge as supporting expertise.

Do not run a duplicate Matt/repository-local TDD framework as a second process.

### 10.4 Planning and design

Primary:

```text
Superpowers brainstorming / writing-plans
```

Use when useful:

```text
Matt domain-modeling
Matt codebase-design
Matt wizard
```

These deepen the technical design; they do not replace the current project
decision authority or Superpowers process.

### 10.5 Implementation execution

Use the appropriate Superpowers execution mode, such as:

```text
subagent-driven-development
executing-plans
```

Do not introduce a separate `implement` process owner.

### 10.6 Ticket generation and triage

Use current available ticket/triage capability in support of the GitHub queue.

Technical ticket granularity can be decided autonomously unless the split would:

- change product scope;
- change business/legal behavior;
- cross a Human Gate;
- alter risk materially.

### 10.7 Git safety

Autonomy expands permission to use:

- branches;
- worktrees;
- commits;
- pushes;
- PRs.

It does not grant permission to:

- destroy unknown work;
- rewrite protected history;
- force-push protected shared branches;
- discard unreviewed owner changes.

### 10.8 Code review

Use the Superpowers review lifecycle.

Matt `code-review` may provide deeper engineering review.

ECC/security/platform review should be added when the touched surface requires
specialist analysis.

A reviewer must verify findings rather than merely agree with the implementer.

### 10.9 Security specialist

For high-risk auth/RLS/privacy/uploads/moderation/privileged/secrets work, use
the currently available security specialist through the ECC/platform layer.

If an optional external security integration is unavailable:

- do not pretend it ran;
- use the current required repository security contracts/static review/
  Supabase/Postgres checks;
- record the limitation truthfully.

Missing optional tooling must not silently lower the required security bar.

### 10.10 Supabase/PostgreSQL specialist

Use Supabase/PostgreSQL specialist tooling when useful for:

- database schema;
- RLS;
- migrations;
- functions;
- Storage;
- Auth;
- hosted target verification.

Repository checks remain authoritative where applicable:

```text
pnpm db:lint
pnpm db:test
relevant DB contract tests
```

Hosted DB mutations require current target-locking and exact named-gate scope.

Do not treat generic Supabase access as permission to mutate the hosted project.

### 10.11 Cloudflare specialist

Use Cloudflare-specific expertise for:

- Workers;
- bindings;
- runtime limits;
- headers;
- Turnstile;
- Images;
- deployment;
- compatible rollback;
- Cloudflare provider configuration.

Generic Vercel/Node deployment assumptions must not override the project's
Cloudflare architecture.

### 10.12 UI/UX and accessibility

For material UI work, use the currently approved UI/design specialists where
useful.

The durable product/UI specification and established marketplace visual
conventions remain authoritative.

Specialists may improve:

- usability;
- accessibility;
- visual consistency;
- component composition.

They may not silently change product semantics.

### 10.13 Browser verification

Changes affecting a user journey should receive browser-level verification
appropriate to risk/scope.

Examples include:

- registration/login/onboarding/password recovery;
- listing create/upload/publish/edit/close;
- search/filter/detail/favorite/offer;
- chat/deal/review;
- report/moderation/admin/MFA;
- settings/account lifecycle.

Use Playwright plus current browser verification capability where applicable.

### 10.14 Human external setup

When the owner must configure a provider, secret or dashboard setting, use the
current Human Gate/wizard mechanism.

The experience should:

1. explain why the action is needed;
2. present only the required steps;
3. avoid exposing secrets;
4. verify resulting state afterward;
5. preserve only non-sensitive evidence.

### 10.15 Wayfinding / ambiguous broad goals

When a request is too broad to safely become executable work, use the current
planning/wayfinding capability to turn it into:

- clarified decisions;
- scoped specs;
- GitHub Issues;
- dependency structure.

Do not launch a giant implementation from a broad instruction such as:

```text
make the whole project production-ready
```

without first resolving the executable structure.

---

## 11. Autonomous execution loop

The implemented state machine belongs in:

```text
docs/agents/EXECUTION-LOOP.md
```

Its design is:

```text
START / CONTINUE
      │
      ▼
Read governing docs + current state
      │
      ▼
Inspect GitHub ready frontier
      │
      ├── no ready issue ──► reconcile/derive work from current approved phase/plan
      │
      ▼
Select highest-priority unblocked issue
      │
      ▼
Confirm R0/R1/R2/R3
      │
      ├── unresolved Human Gate ──► HUMAN GATE
      │
      ▼
Create/reuse isolated implementation context
      │
      ▼
Read issue-specific authority/specs
      │
      ├── reversible technical choice ──► agent decides from evidence
      │
      └── genuine product/legal/protected choice ──► HUMAN GATE
      │
      ▼
TDD / implementation
      │
      ▼
Focused verification
      │
      ├── fail ──► systematic debugging + repair budget ──► retry
      │
      ▼
Independent review
      │
      ├── valid findings ──► fix + verify + re-review
      │
      ▼
Specialist review where required
      │
      ├── findings ──► fix + verify + re-review
      │
      ▼
Full required verification
      │
      ▼
Commit + push + PR
      │
      ▼
GitHub CI
      │
      ├── fail ──► inspect real logs + repair budget ──► push
      │
      ▼
Merge gate
      │
      ├── R0/R1 + all green ──► AUTO-MERGE
      │
      ├── R2 ──► H3 ──► approve / reject
      │
      └── R3 action required ──► HUMAN GATE
      │
      ▼
Post-merge verification when required
      │
      ▼
Close/reconcile issue and current docs if state changed
      │
      ▼
Clean completed branch/worktree
      │
      ▼
Select next ready issue
      │
      └────────────────────────────► LOOP
```

Named-gate scope constrains every state in this loop.

---

## 12. Verification matrix

The canonical current verification rules belong in repository governance and
issue/gate contracts.

This design establishes the following minimum philosophy.

### R0

Typical requirements:

- narrow formatting/schema/link/diff check;
- verify only intended files changed.

### R1

Typical baseline:

- focused affected tests;
- `pnpm check` when TypeScript/Svelte changes;
- `pnpm build` when runtime/build surface changes;
- relevant component/contract/E2E coverage;
- independent review;
- GitHub CI before auto-merge.

### R2

As applicable:

- all relevant R1 checks;
- broader unit/contract tests;
- DB lint for DB work;
- DB tests/pgTAP for DB/RLS work;
- DB contract tests;
- migration-from-scratch/local reset where appropriate;
- hostile-client/security tests;
- relevant Playwright lifecycle;
- security specialist review;
- Supabase/Cloudflare specialist review where relevant;
- independent final code review;
- GitHub CI;
- H3 before merge.

An R2 task's exact acceptance criteria may be stricter than this generic
baseline.

### R3

Before asking the owner to act:

- dry-run/preflight where possible;
- exact environment/target identified;
- backup/recovery plan where relevant;
- verification commands prepared;
- owner-friendly action instructions;
- secrets kept out of chat/docs.

After the owner action:

- verify resulting external state;
- record sanitized evidence;
- continue autonomously if the result passes.

---

## 13. Failure handling

### 13.1 CI failure

Inspect the actual CI logs.

Do not guess from a red status indicator.

Within the repair budget:

1. determine root cause;
2. apply materially different fixes as evidence dictates;
3. rerun local relevant verification;
4. push;
5. re-check CI.

When the H6 budget is exhausted, provide a compact blocker brief including:

- failing check;
- root-cause evidence;
- attempts made;
- current best explanation;
- whether any hosted/production state changed;
- recommended next action.

### 13.2 Review disagreement

Use receiving-code-review discipline:

- verify the review claim;
- fix valid findings;
- push back on incorrect findings with technical evidence;
- do not perform agreement theatrics.

### 13.3 Unexpected scope expansion

If implementation reveals an independent issue:

- repair it in the current task only when it is a small necessary prerequisite,
  remains inside current risk/scope, and does not hide an independent issue;
- otherwise create/reconcile a separate GitHub Issue.

A newly discovered R2/R3 problem must not be hidden inside an R1 PR.

An adjacent named-gate mutation must not be smuggled into the current gate.

### 13.4 External-system ambiguity

If hosted Supabase, Cloudflare or another provider state cannot be confidently
identified:

- fail closed;
- preserve current safe state;
- verify target;
- stop before mutation where authority/identity remains ambiguous.

Do not guess a provider target.

---

## 14. Branch / PR / merge policy

### 14.1 Isolation

Non-trivial executable work should use an appropriately isolated branch/worktree
or other repository-approved isolated context.

Parallel work is appropriate only when tasks are genuinely independent.

### 14.2 Commits

Agents may create intentional scoped commits without routine owner approval.

Commit messages should describe the behavior/change, not the agent process.

### 14.3 Pull requests

PRs should include, as applicable:

- GitHub Issue;
- risk level;
- what changed;
- acceptance criteria;
- verification evidence;
- specialist reviews;
- migrations/external configuration involved;
- explicit unresolved findings.

### 14.4 Auto-merge

R0/R1 may auto-merge only when:

- required fresh local verification passes;
- independent review has no unresolved Critical/Important finding;
- required specialist review passes;
- GitHub required checks are green;
- branch satisfies repository merge policy;
- no Human Gate remains.

### 14.5 R2 merge

R2 waits at H3 even when:

- local tests are green;
- reviewers approve;
- CI is green.

The owner approval should be recorded non-sensitively in the appropriate
issue/PR evidence.

### 14.6 Production deployment

Code merge does not imply production authority.

Production:

- migrations;
- secret/config changes;
- destructive actions;
- payment activation;
- infrastructure mutation;

remain separately protected.

---

## 15. Documentation model

### 15.1 Root `AGENTS.md`

Keep it concise and authoritative.

It should define or point to:

- autonomy default;
- architecture/security/product invariants;
- risk/Human Gate summary;
- execution precedence;
- current required agent docs;
- verification expectations.

### 15.2 `docs/agents/`

The implemented detailed governance layer includes:

```text
docs/agents/AUTONOMY.md
docs/agents/EXECUTION-LOOP.md
docs/agents/SKILL-ROUTER.md
docs/agents/HUMAN-GATES.md
docs/agents/issue-tracker.md
docs/agents/domain.md
```

Do not recreate these files from this historical design without inspecting their
current contents.

### 15.3 Master Plan

`docs/MASTER-PLAN.md` remains durable product/phase/owner-decision authority.

Do not turn it into a work journal.

### 15.4 Project Status

`docs/PROJECT-STATUS.md` remains a concise living snapshot.

Update it only when:

- current phase;
- blocker;
- readiness;
- major capability;
- next-state dependency;

materially changes.

### 15.5 Task-result documents

Routine engineering history should live in:

```text
GitHub Issue
+ PR
+ review
+ CI
```

Dedicated tracked evidence documents remain appropriate for significant
artifacts such as:

- security audits;
- major gate closure;
- release/deployment evidence;
- hosted acceptance;
- incidents;
- backup/restore rehearsals;
- significant architecture decisions.

Do not ask the owner after every ordinary task whether a separate Markdown task
report should be created.

---

## 16. Security and privacy invariants autonomy may never override

### Normal-user authentication

- Public email/password registration remains the current normal-user model.
- Email confirmation remains required according to current product/security
  policy.
- Do not reintroduce normal-user invite-only admission.
- Do not reintroduce phone/SMS OTP as a requirement for normal-user activation,
  first listing, offers, or ordinary marketplace actions.
- Legacy invitation/bootstrap code may remain only for explicitly documented
  operator/first-admin compatibility.

### Staff/admin security

- Staff/admin MFA/AAL2 remains mandatory.
- Staff/moderator access remains least-privileged and case/report scoped where
  required.
- Privileged access should remain auditable.

### Privacy/secrets

Never expose:

- secrets;
- auth tokens;
- cookies;
- private email/phone;
- raw private profile data;
- private evidence;
- TOTP seeds;
- service-role credentials.

### Database/security

- Preserve server-first architecture.
- RLS remains an authoritative hostile-client boundary.
- Service-role access is not a convenience substitute for ordinary
  authorization.
- Never edit existing Supabase migrations.
- Hosted evolution is forward-only.
- Security failures fail closed.

### Product/business

- The underlying perfume transaction remains off-platform.
- Payment/billing/listing-fee/subscription/boost/advertising/provider
  scaffolding does not authorize activation.
- Monetisation remains disabled until applicable business/legal/production
  gates.
- Merchant verification remains a free trust status and is not sold.

### Test/staging

- Use synthetic accounts/data where possible.
- Real-user data must not be copied into staging tests.
- Target-lock hosted mutations.
- Staging credentials do not grant production authority.

---

## 17. Component/refactor policy

Autonomy must not become:

```text
refactor everything
```

For large components such as:

```text
ListingWizard.svelte
admin/+page.svelte
listing/[slug]/+page.svelte
```

prefer opportunistic extraction.

Do not create a broad file-splitting project solely because a file is large.

Extract a coherent subsection only when:

- current authorized work already touches it;
- extraction reduces implementation/review risk;
- behavior is protected with focused tests;
- accessibility/form semantics remain intact;
- the resulting diff remains reviewable.

---

## 18. Historical remediation priorities carried into the design

At design time, immediate engineering priorities included:

1. lazy auth access/data-requirement correction;
2. lifecycle regression coverage for onboarding/login/password/MFA;
3. public registration Turnstile;
4. ListingWizard component regression coverage;
5. bounded public/request-form parsing;
6. lighter admin/listing-detail smoke coverage;
7. messaging semantics once product/legal decisions existed;
8. hosted/security/release blockers.

These priorities are preserved as historical design context.

They are **not** the current executable queue.

Current GitHub Issues and gate evidence determine what remains open.

Do not reopen a completed Gate 1/Gate 2/Gate 3 subtask simply because it appears
here.

---

## 19. Hosted / staging execution

The design supports autonomous non-production hosted verification **inside an
already authorized exact scope**.

It does not grant generic staging mutation authority.

Hosted work may include, when current issue/gate authority permits:

- target-locked staging migration/application verification;
- hosted Auth configuration verification;
- synthetic registration/onboarding/lifecycle tests;
- Turnstile verification;
- transactional email tests;
- report-evidence isolation/cleanup;
- real multi-session race tests;
- backup/restore rehearsal;
- Cloudflare staging deployment/rollback verification;
- monitoring validation.

Requirements include:

- exact authorized target;
- current project identity;
- synthetic data;
- safe secret handling;
- named-gate scope;
- forward-only migration posture;
- cleanup evidence;
- no production crossover.

Production promotion remains separately protected.

---

## 20. Historical setup / implementation strategy

The original autonomy conversion was intended to be introduced as a small,
reviewable governance/infrastructure change rather than mixed with marketplace
feature work.

The following setup sequence is preserved as historical implementation design.

It should **not** be rerun automatically after the governance already exists.

### Setup Task A — Governance docs

Originally:

- replace owner-interrupt-heavy root `AGENTS.md` rules;
- create detailed `docs/agents/` governance;
- preserve architecture/security/product invariants;
- remove wait-for-instructions behavior;
- remove mandatory per-task result-file question.

Current action:

> inspect and repair only genuine current governance drift.

### Setup Task B — GitHub execution vocabulary

Originally:

- inspect current labels;
- add priority/risk/agent-state/Human Gate metadata;
- document deterministic selection.

Current action:

> use the vocabulary in current `docs/agents/issue-tracker.md`; do not reinstall
> the label model merely because this setup task exists.

### Setup Task C — Capability routing

Original design contemplated installing/connecting process and specialist
capabilities.

Current architecture:

```text
Superpowers = process
Matt Pocock = deep engineering
ECC/platform = specialists
```

Do **not** install new skills merely to satisfy this historical task.

Do not create overlapping workflow packs.

### Setup Task D — Convert planning work to GitHub Issues

Historical intent:

- decompose approved plans into vertical executable issues;
- classify priority/risk;
- encode dependencies;
- identify ready frontier.

Current action:

> GitHub Issues remain canonical. Reconcile only missing/stale current issue
> state.

### Setup Task E — Validate R1 autonomy

Historical intent:

```text
ready issue
→ branch/worktree
→ TDD/implementation
→ review
→ verification
→ CI
→ auto-merge
→ issue close
→ next issue
```

Current action:

> this is a validation property of the implemented autonomy system, not a setup
> task that must be repeated on every agent session.

### Setup Task F — Validate R2 H3

Historical intent:

```text
R2 implementation
→ full verification
→ review/CI
→ H3
→ merge only after owner approval
```

Current action:

> preserve H3 whenever current work is R2.

---

## 21. Success criteria

The autonomy model succeeds when:

1. a fresh agent can determine the active phase/gate without owner explanation;
2. “Continue” is enough to begin the next normal ready issue;
3. reversible technical questions do not interrupt the owner;
4. Superpowers is the single process authority;
5. Matt is used as deep-engineering support rather than a competing workflow;
6. ECC/platform capabilities are used as specialists;
7. R0/R1 can reach verified auto-merge;
8. R2 reaches a fully verified PR but stops for H3;
9. R3 actions remain protected;
10. agents inspect real CI logs and self-repair ordinary failures;
11. review/security/DB/Cloudflare/UI/browser capability routes by touched
    surface;
12. privacy/RLS/migration/product invariants remain intact;
13. GitHub Issues represent the executable frontier and dependencies;
14. routine work does not generate unnecessary long-form task-result files;
15. `PROJECT-STATUS.md` remains concise/current;
16. owner-facing Human Gates are understandable without programming knowledge;
17. exhausted repair loops stop safely rather than guessing;
18. named-gate mutation scope remains strict;
19. staging/production authority remains separate;
20. the system continues task-to-task until phase completion or a genuine
    Human Gate.

---

## 22. Explicit non-goals

This operating model does not by itself:

- declare the marketplace production-ready;
- complete the remediation backlog;
- make legal/privacy/business decisions;
- enable payments;
- activate monetisation;
- authorize production migrations;
- grant unrestricted production credentials;
- replace deterministic tests/CI with agent opinion;
- authorize broad unrelated refactors;
- remove H3 from R2;
- remove owner authority from R3;
- authorize staging/provider mutations outside named scope;
- guarantee every external provider can be automated in every environment;
- turn historical planning documents into current execution queues.

---

## 23. Owner-approved design decisions captured by this specification

The following are the durable design decisions captured by the 2026-08-08
autonomy specification and reconciled with the implemented architecture:

1. **Goal:** development should be as autonomous as safely practical for a
   non-programmer owner.
2. **Normal behavior:** agents proceed without asking for ordinary reversible
   technical decisions.
3. **Low/normal-risk merges:** R0/R1 may be autonomous after required
   verification/review/CI.
4. **High-risk engineering:** R2 engineering proceeds autonomously but requires
   H3 before merge.
5. **Protected production/destructive/policy actions:** remain human-controlled
   under R3/Human Gate rules.
6. **Owner review UX:** plain-language summary first; technical detail only when
   requested.
7. **Primary process framework:** Superpowers.
8. **Matt Pocock skills:** deep-engineering support, not competing process
   authority.
9. **ECC/platform capabilities:** specialists, not competing process authority.
10. **Canonical executable queue:** GitHub Issues.
11. **Large component splitting:** opportunistic, not a broad standalone
    refactor.
12. **Evidence before completion:** fresh verification is mandatory.
13. **Named-gate scope:** autonomy does not authorize adjacent mutations.
14. **Environment isolation:** staging authority does not imply production
    authority.
15. **Product invariants remain independent of autonomy:** public normal-user
    email/password registration, no normal-user invite/SMS gate, staff/admin
    AAL2, off-platform perfume transaction, and disabled monetisation remain
    governed by their authoritative project decisions.

---

## 24. Specification self-review

### Historical placeholders

The original specification intentionally contained no TBD/TODO placeholders.

Any setup-oriented language that has since been implemented is now treated as
historical design intent rather than an instruction to reinstall the operating
model.

### Internal consistency

The reconciled design is internally consistent:

- R0/R1 may auto-merge only after required gates.
- R2 always stops at H3 before merge.
- R3 remains protected.
- Superpowers owns process.
- Matt provides deep-engineering support.
- ECC/platform systems provide specialist support.
- GitHub Issues are the executable queue.
- named-gate scope constrains autonomy.
- repository/product/security authority outranks skills.
- existing migrations remain immutable.
- hosted database evolution remains forward-only.
- staging and production authority remain separate.

### Scope

This design is limited to engineering orchestration/governance.

It does not redefine marketplace behavior merely because automation would be
simpler with a different product model.

### Autonomy boundary

The central boundary remains:

> **Reversible technical engineering decisions are delegated. Product, legal,
> privacy, business, R2 merge and protected R3 actions remain behind their
> applicable Human Gates.**

### Reuse rule

A future agent finding this file should:

1. treat it as the design rationale for the implemented autonomy model;
2. read current `AGENTS.md` and `docs/agents/` for executable governance;
3. inspect current GitHub Issues for executable work;
4. use current gate/status evidence for current state;
5. avoid repeating historical setup tasks;
6. repair only genuine current drift;
7. never infer hosted/provider/production authority from this dated
   specification.
