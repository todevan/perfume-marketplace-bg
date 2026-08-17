# Issue Tracker and Autonomous Queue

## Purpose

This document defines the repository's canonical engineering queue, issue quality contract, deterministic task selection, and issue/PR state transitions.

It does **not** define a second planning, debugging, TDD, review, or completion workflow.

Repository instructions and project source-of-truth documents remain the highest authority.

For implementation process:

* Superpowers is the primary process authority.
* Matt Pocock skills provide optional deep engineering analysis.
* ECC and platform-specific skills provide specialist analysis.
* GitHub Issues defined here remain the canonical engineering queue.

Do not run competing planners, debugging loops, TDD systems, or completion workflows merely because multiple installed skill systems can perform similar work.

---

## Canonical tracker

This repository uses GitHub Issues:

`https://github.com/todevan/perfume-marketplace-bg/issues`

Engineering skills that expect an issue tracker must use GitHub Issues through the GitHub integration or `gh` CLI and the repository's `origin` remote.

Pull requests are implementation/review surfaces, not the default triage queue.

Do not create an independent task queue inside:

* Superpowers plans;
* Matt Pocock skill output;
* ECC specialist output;
* PR comments;
* local scratch files;
* agent memory.

Plans, reviews, audits, and specialist findings that require durable engineering work should ultimately map to GitHub Issues unless repository instructions explicitly define another artifact for that work.

---

## Authority and skill routing

Issue tracking coordinates the unified agent architecture but does not replace it.

Authority order:

```text
Repository docs / AGENTS.md
        ↓
Issue scope / acceptance criteria
        ↓
Superpowers process
        ↓
Matt Pocock deep engineering, when useful
        ↓
ECC / platform specialists, when useful
```

### Superpowers

Use Superpowers for the primary engineering process where applicable, including:

* brainstorming;
* writing plans;
* systematic debugging;
* TDD;
* plan execution;
* code-review workflow;
* verification before completion.

An issue should normally enter **one** Superpowers process path appropriate to the work.

Do not start another planner, debugger, TDD loop, or completion workflow from Matt Pocock or ECC when Superpowers already owns that process stage.

### Matt Pocock skills

Matt Pocock skills may deepen issue analysis without replacing the primary process.

Typical uses include:

* `diagnosing-bugs` for deeper causal reasoning after or within Superpowers systematic debugging;
* `domain-modeling` for domain boundaries and invariants;
* `codebase-design` for architecture and implementation boundaries;
* `code-review` for an independent engineering-depth review;
* `wizard` for exact human-executable provider/dashboard instructions when an owner-performed protected step is required;
* `writing-for-agents` when improving durable agent-facing specifications.

Matt output may refine:

* issue context;
* acceptance criteria;
* invariants;
* implementation constraints;
* verification expectations.

It must not create a parallel execution lifecycle.

### ECC and platform specialists

ECC or platform-specific skills may provide specialist analysis for areas such as:

* security;
* backend behavior;
* E2E / Playwright;
* evals;
* documentation lookup;
* Supabase;
* Cloudflare;
* GitHub integrations.

Specialists should contribute findings and verification requirements to the existing issue or create a new GitHub issue when genuinely separate work is discovered.

They must not establish a competing queue or autonomous workflow.

### Typical routing examples

Bug:

```text
GitHub Issue
→ Superpowers systematic-debugging
→ Matt diagnosing-bugs if deeper reasoning is useful
→ Superpowers TDD / implementation
→ review
→ verification
→ issue/PR state transition
```

Feature:

```text
GitHub Issue
→ Superpowers brainstorming / writing-plans where needed
→ Matt domain-modeling / codebase-design if useful
→ Superpowers TDD / execution
→ review
→ verification
→ issue/PR state transition
```

Security-sensitive work:

```text
GitHub Issue
→ Superpowers process
→ Matt design/domain reasoning if useful
→ ECC security specialist
→ independent review
→ verification
→ H3 before merge when R2
```

These are routing examples, not additional mandatory lifecycle stages.

Use only the skills that materially improve the task.

---

## Required automation labels

The autonomy setup uses this small deterministic vocabulary.

### Priority

* `priority:P0` — active blocker/security/correctness issue that should be handled first.
* `priority:P1` — important near-term work.
* `priority:P2` — useful follow-up / non-blocking quality work.
* `priority:P3` — opportunistic/low urgency.

### Risk

* `risk:R0` — trivial/documentation.
* `risk:R1` — normal engineering; eligible for auto-merge after gates.
* `risk:R2` — high-risk engineering; owner approval required before merge.
* `risk:R3` — protected production/policy action; owner involvement required.

Risk classification must follow the repository autonomy and human-gate documents.

Skill choice does not change the issue's risk class.

A task does not become lower risk because a specialist reviewed it.

### Agent state

* `agent:ready` — executable now; dependencies resolved.
* `agent:working` — currently owned by an active implementation.
* `agent:blocked` — known dependency or blocker prevents implementation.
* `agent:review` — implementation exists and is in review/CI/high-risk gate.

### Special

* `human-gate` — issue cannot proceed through its current boundary without H1–H6.
* `hosted-required` — acceptance requires verified staging/hosted-provider evidence.

Do not create dozens of decorative labels.

Existing useful product/type labels may remain.

Do not create labels merely to represent which skill system was used. Skill routing belongs in the execution context, not the canonical queue vocabulary.

---

## Initial label bootstrap

An agent with GitHub permissions may create/update the minimum labels using `gh` from the repository root:

```bash
gh label create 'priority:P0' --color B60205 --description 'Immediate blocker / highest priority' --force
gh label create 'priority:P1' --color D93F0B --description 'Important near-term work' --force
gh label create 'priority:P2' --color FBCA04 --description 'Useful non-blocking follow-up' --force
gh label create 'priority:P3' --color C5DEF5 --description 'Low urgency / opportunistic' --force

gh label create 'risk:R0' --color EDEDED --description 'Trivial/documentation risk' --force
gh label create 'risk:R1' --color 0E8A16 --description 'Normal engineering; auto-merge eligible after gates' --force
gh label create 'risk:R2' --color B60205 --description 'High-risk engineering; owner approval before merge' --force
gh label create 'risk:R3' --color 5319E7 --description 'Protected production/policy action' --force

gh label create 'agent:ready' --color 0E8A16 --description 'Executable now; dependencies resolved' --force
gh label create 'agent:working' --color 1D76DB --description 'Active implementation in progress' --force
gh label create 'agent:blocked' --color B60205 --description 'Blocked by dependency or decision' --force
gh label create 'agent:review' --color 5319E7 --description 'Implementation in review/CI/gate' --force

gh label create 'human-gate' --color D4C5F9 --description 'Owner decision/action is required at current boundary' --force
gh label create 'hosted-required' --color 006B75 --description 'Acceptance requires verified hosted/staging evidence' --force
```

If `gh` is unavailable, use the GitHub integration.

If neither can mutate labels, trigger H4 only for the minimum setup action rather than blocking unrelated local engineering.

---

## Ticket quality contract

Every autonomous executable issue should contain:

1. **Outcome** — observable result, not an implementation wish.
2. **Context** — why the work exists and relevant source-of-truth docs.
3. **Acceptance criteria** — concrete pass/fail behaviors.
4. **Verification** — expected tests/checks/browser/database/provider evidence.
5. **Risk class** — R0/R1/R2/R3 with a short reason.
6. **Dependencies** — `Blocked by #123` entries when applicable.
7. **Out of scope** — nearby changes the agent should not absorb.

An executable issue should contain enough information for the agent to begin the normal execution process without inventing product policy.

Implementation details do not need to be predetermined when the selected engineering process can safely derive them.

Do not over-specify an issue merely to encode the internal workflow of a particular skill.

### Skill-derived issue improvements

Superpowers plans may supply:

* task decomposition;
* dependency ordering;
* acceptance boundaries;
* verification expectations.

Matt Pocock skills may supply:

* domain invariants;
* architecture constraints;
* failure models;
* deeper technical acceptance criteria.

ECC or platform specialists may supply:

* threat/security requirements;
* backend constraints;
* E2E evidence;
* provider-specific verification;
* authoritative documentation findings.

These inputs should improve the same canonical ticket rather than create competing specifications.

If specialist analysis discovers genuinely independent work, create a separate issue with explicit dependencies.

---

## Plans and ticket conversion

Use repository `to-tickets` for approved multi-task plans.

Planning artifacts are not a substitute for the GitHub queue.

When an approved plan contains multiple independently executable units, convert them into vertical GitHub issues with:

* explicit outcomes;
* dependency edges;
* risk classifications;
* acceptance criteria;
* verification;
* out-of-scope boundaries.

Do not decompose work solely according to which skill will execute it.

Issues should represent product/engineering outcomes, not skill invocations.

Bad decomposition:

```text
Issue 1: Run domain-modeling
Issue 2: Run security skill
Issue 3: Run Playwright
```

Preferred decomposition:

```text
Issue 1: Enforce listing ownership invariant
Issue 2: Protect moderation mutation boundary
Issue 3: Verify hosted authenticated reporting flow
```

The appropriate skills are routed during execution.

---

## Scope discipline

The issue is a hard scope boundary unless a higher-authority repository document says otherwise.

If a task is explicitly constrained to a named gate or phase such as:

```text
A9 only
```

the agent must not perform mutations belonging to:

* A8;
* A10;
* an earlier prerequisite;
* a later cleanup phase;
* production;
* unrelated provider configuration.

A discovered prerequisite outside the authorized scope should normally become:

* a dependency;
* a blocker;
* a separate issue;
* or the appropriate Human Gate.

Do not silently absorb it into the active issue.

Incidental local fixes are allowed only when permitted by the repository's autonomy and repair-budget rules.

---

## State transitions

Normal lifecycle:

```text
agent:ready
   ↓ selected
agent:working
   ↓ PR opened / implementation review
agent:review
   ↓ merged
issue closed
```

Blocked lifecycle:

```text
agent:ready/working
   ↓ dependency discovered
agent:blocked
   ↓ dependency resolved
agent:ready
```

Human gate:

```text
agent:blocked + human-gate
   ↓ owner decision/action recorded
remove human-gate
   ↓
agent:ready or agent:review
```

Do not apply `agent:ready` while unresolved dependency text is known.

Do not leave an issue in `agent:working` merely because an agent session ended.

The state should describe the repository task, not the lifetime of a particular agent invocation.

---

## Deterministic selection algorithm

From the active phase, choose:

1. ready P0;
2. ready P1;
3. ready P2;
4. ready P3;
5. unblockers before tasks they unblock;
6. lower-risk work first at equal priority/dependency, unless an R2 item blocks more work;
7. oldest ready issue as final tie-breaker.

Skip:

* issues already being implemented in another active branch/PR;
* `human-gate` issues whose decision is unresolved;
* tasks outside the active phase unless they are required unblockers;
* issues contradicted by a newer owner decision/source of truth;
* issues whose required dependency is unresolved;
* issues whose named gate scope does not authorize the needed mutation.

Skill availability must not influence task priority.

For example, the existence of a security, backend, or debugging specialist does not justify skipping a higher-priority ready issue.

---

## Work ownership and concurrency

Before moving an issue to `agent:working`, confirm that another active implementation is not already responsible for the same scope.

Parallel work is appropriate only when the tasks are genuinely independent.

When two issues share mutable implementation boundaries, prefer explicit dependency ordering rather than parallel agents creating overlapping fixes.

Specialist analysis may run within the active task without claiming separate queue ownership.

The issue remains owned by the primary implementation process.

---

## Issue/PR linkage

Branch and PR should retain issue identity.

PR body should contain:

```text
Closes #<number>
```

or the repository's equivalent, plus the current risk class.

The PR should remain traceable to:

* the issue outcome;
* acceptance criteria;
* verification evidence;
* risk classification;
* relevant Human Gate when applicable.

Do not use the PR as a replacement specification when the corresponding issue should be updated instead.

---

## R0 / R1 merge path

R0 and R1 work may proceed through autonomous merge only when all repository-defined gates are satisfied.

That includes the applicable:

* tests;
* review;
* CI;
* verification-before-completion;
* scope checks;
* hosted evidence when required.

The presence of multiple agreeing skill outputs is not itself verification.

Evidence must come from the repository-defined checks.

---

## R2 merge path

When an R2 PR is green:

1. move the issue to `agent:review`;
2. ensure `human-gate` is present for H3 when label automation is used;
3. complete the required review and verification;
4. present the H3 brief;
5. stop before merge.

Remove or resolve the Human Gate only after explicit owner approval.

R2 may be implemented autonomously where repository policy allows, but it must not auto-merge.

Matt or ECC specialist approval does not substitute for H3.

---

## R3 boundaries

R3 work remains protected by repository policy.

Issue selection does not authorize an agent to perform protected production, policy, privacy, legal, destructive, or owner-only actions.

When execution reaches an R3 boundary:

* preserve completed safe work;
* record the exact remaining boundary;
* mark/block the issue appropriately;
* invoke the relevant Human Gate;
* do not mutate the protected surface without authorization.

---

## Hosted-required issues

Apply `hosted-required` when acceptance depends on real staging/provider behavior that local tests cannot prove.

Examples may include:

* staging authentication;
* provider secrets/configuration;
* deployed Worker behavior;
* Supabase hosted state;
* Cloudflare behavior;
* authenticated hosted actors;
* externally observable E2E flows.

A local mock or unit test does not satisfy a hosted requirement unless the issue explicitly says it does.

Hosted evidence must follow the repository's release, provider, security, and named-gate restrictions.

Do not perform unrelated provider mutations merely to satisfy hosted verification.

---

## Findings discovered during implementation

When implementation, review, debugging, or specialist analysis discovers additional work:

### Fix inside the current issue when

* it is required to satisfy the existing acceptance criteria;
* it remains inside the authorized scope;
* it fits the applicable repair budget;
* it does not materially change risk or product behavior.

### Create or update a separate issue when

* it is independent follow-up work;
* it expands scope;
* it belongs to another named gate or phase;
* it has a different risk class;
* it requires another owner decision;
* it would materially delay the current outcome.

### Block and gate when

* correctness depends on an unresolved H1–H6 decision;
* a prerequisite cannot be safely resolved inside current authority;
* a protected provider/production action is required;
* required evidence cannot currently be obtained.

Do not hide newly discovered high-risk work inside an unrelated R1 ticket.

---

## Review findings and queue hygiene

Review findings should be classified before becoming durable queue items.

A review comment that must be fixed before the current issue is complete belongs to the active issue/PR workflow.

A valid but independent finding should become a GitHub issue with the appropriate:

* priority;
* risk;
* dependencies;
* acceptance criteria;
* verification.

Do not turn every stylistic suggestion or speculative improvement into queue noise.

Prefer a small actionable backlog over a large decorative one.

---

## Plan-to-ticket conversion

When an approved remediation or implementation plan contains executable work, convert it into vertical GitHub issues rather than treating the plan as a parallel queue.

Preserve the plan's:

* priority;
* dependency ordering;
* risk boundaries;
* named-gate sequencing;
* source-of-truth constraints.

The first autonomous dry run should be a low-risk test task such as `ListingWizard.svelte` component coverage, not an auth/RLS migration.

The first genuine R2 remediation should be used to prove that the system stops at H3 rather than auto-merging.

Superpowers remains responsible for the execution process.

Matt Pocock skills may deepen engineering reasoning where useful.

ECC/platform specialists may provide domain-specific evidence where useful.

None of them replace GitHub Issues as the canonical queue.

---

## Core invariant

At all times:

```text
Repository defines what is allowed.
GitHub Issues define what work is queued.
Superpowers defines the primary process.
Matt Pocock skills deepen engineering reasoning.
ECC/platform skills provide specialist expertise.
Human Gates define where autonomy stops.
Verification evidence determines whether work is complete.
```

Do not duplicate these responsibilities across competing agent systems.
