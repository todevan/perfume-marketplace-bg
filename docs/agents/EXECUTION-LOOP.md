# Autonomous Execution Loop

## Purpose

This file is the repository's engineering state machine.

A capable Codex agent should be able to enter a fresh session, establish repository truth, choose work, execute it, verify it, merge permitted work, update state and continue until the active phase finishes or a Human Gate is reached.

The unified operating model is:

- **Repository authority** determines scope, risk, permissions and evidence.
- **Superpowers** owns the primary engineering process.
- **Matt Pocock skills** provide engineering-depth assistance inside that process.
- **ECC/repository/platform skills** provide narrow specialist expertise.

Only one primary process workflow runs for a task.

Specialists compose underneath it.

---

# State machine

```text
SESSION START
    ↓
Invoke/read applicable Superpowers startup guidance
    ↓
Read AGENTS + MASTER-PLAN + PROJECT-STATUS + agent operating docs
    ↓
Inspect git/worktrees/recent merged work
    ↓
Inspect referenced gate/spec/plan/receipt when applicable
    ↓
Inspect GitHub issue frontier
    ↓
Reconcile obviously stale issue/project state
    ↓
Select highest-priority executable issue
    ↓
Classify R0/R1/R2/R3
    ↓
Human Gate already required? ── yes → complete safe preparation → present gate → stop
    │
    no
    ↓
Create/enter isolated branch or worktree when non-trivial
    ↓
Resolve specification/process needs through SKILL-ROUTER
    ↓
Add Matt/ECC specialist reasoning only when triggered
    ↓
Implement in small verified slices
    ↓
Focused verification
    ↓
Independent engineering review
    ↓
Triggered specialist review(s)
    ↓
Findings?
    ├── yes → verify finding → fix valid issue → re-run affected checks/review
    └── no
          ↓
Run final verification matrix for final risk class
    ↓
Superpowers verification-before-completion
    ↓
Push/update PR
    ↓
GitHub CI
    ↓
CI failure?
    ├── yes → root-cause repair loop
    └── no
          ↓
R2?
    ├── yes → H3 owner review → approved? → merge / revise
    └── no
          ↓
R0/R1 auto-merge if all gates satisfied
    ↓
Verify actual merge result
    ↓
Close/reconcile issue
    ↓
Update PROJECT-STATUS only if real current state changed
    ↓
Clean completed worktree/branch safely
    ↓
Active phase complete?
    ├── yes → phase completion verification + summary
    └── no → select next ready issue and continue
```

---

# 1. Session startup

Perform these steps without asking permission:

1. Apply Superpowers `using-superpowers` startup discipline when available.
2. Read `AGENTS.md` in full.
3. Read `docs/MASTER-PLAN.md` and `docs/PROJECT-STATUS.md` fully.
4. Read the files under `docs/agents/` referenced by `AGENTS.md`.
5. If the owner references a gate, implementation plan, receipt, incident, PR, commit SHA, deployment or specific document, read that authoritative source before acting.
6. Inspect:

   * `git status`;
   * current branch;
   * worktrees;
   * relevant recent commits;
   * relevant merged PRs.
7. Inspect GitHub Issues according to `issue-tracker.md`.
8. Reconcile obviously stale issue/project state against stronger evidence such as merged code, current git state, approved gate documents and hosted receipts.
9. Identify the active phase and its blocking conditions.
10. Select work using the deterministic selection algorithm below.
11. Classify the selected issue R0/R1/R2/R3.
12. Begin automatically unless a Human Gate is already known.

Do not assume `PROJECT-STATUS.md` is newer than git or a later approved gate/receipt.

Do not silently rewrite status based only on inference.

Progress message format:

```text
Autonomous session started.
Active phase: <phase>
Next issue: #<number> — <title>
Risk: R0/R1/R2/R3
Process: <primary Superpowers workflow>
Specialists: <none / Matt / ECC / platform specialists>
I’ll continue until the phase is complete or a human gate is reached.
```

Do not ask:

> "Should I start?"

for an executable issue already authorized by repository policy.

---

# 2. Deterministic issue selection

Only select issues whose known dependencies are complete and which do not already have an active conflicting implementation.

Order:

1. active-phase P0;
2. active-phase P1;
3. active-phase P2;
4. active-phase P3;
5. within the same priority, unblockers before downstream work;
6. within the same dependency level, lower-risk/reversible work before higher-risk work unless the higher-risk item blocks more work;
7. oldest ready issue as final tie-breaker.

Never select an issue marked `human-gate` until the owner decision/action that blocks it is resolved.

Do not automatically jump into a later product/release phase merely because all currently visible issues are blocked.

If no ready issue exists but the active phase is incomplete:

1. inspect phase blockers;
2. inspect approved plans/specifications;
3. inspect GitHub Issue state;
4. determine whether executable work is simply missing from the queue;
5. create/triage missing executable issues using `to-tickets` / `triage` when appropriate;
6. do not invent product/legal/business behavior;
7. trigger H1/H2 if the missing information belongs to the owner.

For a large unclear initiative, repository `wayfinder` may assist if installed.

It does not replace the Superpowers process once executable work emerges.

---

# 3. Prepare the work

For non-trivial work:

1. identify the authoritative base;
2. sync the base branch safely;
3. inspect existing worktrees;
4. create an isolated feature branch/worktree when appropriate;
5. ensure unrelated dirty work is not carried into the task;
6. preserve unknown work;
7. record the issue number in branch/PR context;
8. use small commits describing behavior rather than vague activity.

Preferred process skill:

* Superpowers `using-git-worktrees`.

Repository git guardrails remain authoritative.

R0 documentation-only work may use a simpler branch path if repository policy permits.

Never:

* discard unknown changes;
* reset another agent/user's work;
* force-push protected history merely to simplify the workflow.

---

# 4. Process and specification selection

Use `docs/agents/SKILL-ROUTER.md`.

## Existing approved specification or gate

Do not duplicate it.

Do not run brainstorming merely to recreate already approved behavior.

Read the governing source and execute against it.

If Matt `domain-modeling` or `codebase-design` is useful to understand implementation implications, it may assist without changing the approved behavior.

## Approved specification needing implementation breakdown

Use:

* Superpowers `writing-plans`.

Do not simultaneously run another generic planner.

## New behavior without sufficient definition

Use:

* Superpowers `brainstorming`.

Standing repository approval satisfies ordinary reversible technical design checkpoints after self-review.

Stop only when:

* H1;
* H2;
* another real Human Gate;

is triggered.

## Bug / unexpected behavior

Use:

* Superpowers `systematic-debugging`.

Matt `diagnosing-bugs` may assist with deeper causal analysis.

Do not run two independent debugging methodologies.

## Clear issue with reversible technical choices

The owner has pre-approved agents to choose the repository-consistent technical approach.

Record meaningful choices where useful.

Do not interrupt the owner for routine technical implementation decisions.

---

# 5. Specialist composition

Specialists are invoked only when their trigger applies.

They do not own the task lifecycle.

## Matt Pocock

Use for engineering depth.

Examples:

### `diagnosing-bugs`

Useful when:

* causal chains cross several layers;
* evidence is contradictory;
* performance regressed unexpectedly;
* obvious hypotheses have failed;
* a failure is hard to localize.

It operates inside Superpowers systematic debugging.

### `domain-modeling`

Useful when:

* states/transitions are unclear;
* invariants are subtle;
* terminology is overloaded;
* business behavior spans several modules.

It may clarify implementation design but may not invent product decisions.

### `codebase-design`

Useful when:

* deciding module ownership;
* changing interfaces;
* introducing meaningful abstractions;
* untangling responsibilities directly relevant to the task.

It does not authorize broad cleanup.

### `code-review`

Preferred for detailed engineering review when available.

### `wizard`

Use for owner-required dashboard/provider actions.

### `writing-for-agents`

Use when materially modifying:

* `AGENTS.md`;
* `docs/agents/*`;
* project skills;
* agent/subagent instructions.

## ECC

Use only for narrow specialist expertise.

Examples:

### `security-review`

Use for adversarial security analysis.

Required for applicable R2 security-sensitive work when available.

### `backend-patterns`

Use for backend/server/service/data-flow specialist guidance.

### `e2e-testing`

Use for complex browser/Playwright journey design.

### `eval-harness`

Use only when ordinary deterministic tests are insufficient.

### `documentation-lookup`

Use for current external API/library/platform documentation.

Prefer primary documentation.

---

# 6. Implementation loop

For behavior changes and bugs, work vertically.

Primary lifecycle:

* Superpowers `test-driven-development`.

Use this sequence:

1. define the public seam or observable behavior;
2. write the smallest meaningful failing regression/behavior test;
3. run it;
4. confirm it fails for the expected reason;
5. implement the minimum production change;
6. run the focused test;
7. confirm pass;
8. repeat for the next behavior;
9. refactor only while tests are green;
10. keep refactoring directly tied to current task safety/clarity;
11. run focused static/type checks regularly.

Do not run a second Matt/ECC TDD lifecycle.

Specialist testing skills may improve test design, but Superpowers remains process owner.

Do not write a large speculative batch of tests before production implementation unless the approved plan explicitly requires it.

Do not weaken an existing failing assertion just to create a green test.

---

# 7. Unexpected implementation behavior

When the implementation does not behave as expected:

1. stop speculative editing;
2. inspect actual evidence;
3. enter/re-enter Superpowers `systematic-debugging`;
4. reproduce the failure;
5. identify the failing boundary;
6. form a specific hypothesis;
7. test that hypothesis;
8. use Matt `diagnosing-bugs` if deeper reasoning is valuable;
9. only then modify production code.

Do not treat each random patch as a separate repair hypothesis.

Root cause before fix.

---

# 8. Focused verification during implementation

During iteration, prefer the narrowest relevant check.

Examples:

* focused unit test;
* single contract test;
* single pgTAP file;
* focused Playwright spec;
* affected TypeScript/Svelte check;
* narrow operational script verification.

Do not repeatedly run the full repository matrix while still resolving a narrow failure unless broad interaction is itself under investigation.

Inspect:

* exit status;
* actual output;
* expected failure/pass reason.

A green command that does not exercise the changed behavior is not meaningful verification.

---

# 9. Independent engineering review

Before final completion of R1/R2:

1. inspect the final diff yourself;
2. use Superpowers `requesting-code-review`;
3. use Matt `code-review` when available for detailed engineering review;
4. review:

   * Spec axis;
   * Standards axis;
   * security implications;
   * test quality;
   * regression risk;
   * unnecessary complexity.
5. process findings using Superpowers `receiving-code-review`.

Do not automatically accept reviewer findings.

For each material finding:

1. verify it against the code/spec;
2. classify severity;
3. fix it if valid;
4. push back with technical evidence if invalid.

Critical/Important findings must be resolved before completion unless explicitly accepted through an authorized Human Gate.

---

# 10. Specialist review

Use the final changed surface, not the original task description, to determine specialist triggers.

Examples:

* auth/session/RLS/private data → ECC `security-review`;
* SQL/migrations/RLS/privileged DB → Supabase/PostgreSQL specialist + deterministic DB tests;
* Worker/runtime/deploy → Cloudflare specialist;
* meaningful UI journey → UI/accessibility specialist + browser verification;
* Playwright test architecture → ECC `e2e-testing`;
* server architecture → ECC `backend-patterns`;
* domain/state complexity → Matt `domain-modeling`;
* module/interface design → Matt `codebase-design`;
* external setup requiring owner → Matt/repository `wizard`;
* current external API behavior → ECC `documentation-lookup`.

A specialist finding may raise the risk class.

A specialist cannot lower risk below what repository policy requires.

A specialist PASS does not substitute for final verification.

---

# 11. Security review path

When `SKILL-ROUTER.md` / `AUTONOMY.md` triggers security review:

1. establish the exact trust boundary;
2. identify attacker-controlled inputs;
3. identify privilege boundaries;
4. inspect normal-user behavior;
5. inspect hostile/cross-user behavior;
6. inspect service-role/privileged paths;
7. inspect failure modes;
8. inspect privacy/disclosure behavior;
9. run deterministic security tests;
10. run ECC `security-review` when available;
11. resolve material findings;
12. re-run affected tests;
13. preserve R2 classification where applicable.

Do not treat a normal code review as sufficient specialist security review when explicit security review is required.

---

# 12. Database/RLS path

When changing:

* migrations;
* RLS;
* SQL functions;
* triggers;
* `SECURITY DEFINER`;
* Storage authorization;
* privileged/service-role repositories;

inspect the actual database boundary.

As applicable run:

* focused DB tests;
* `pnpm db:lint`;
* `pnpm db:test`;
* `pnpm test:db:contracts`;
* clean migration/reset from scratch;
* hostile-client tests.

Do not infer database correctness solely from application tests.

Never edit an existing applied migration.

Use a new forward-only migration.

---

# 13. Browser/E2E path

For materially changed user journeys:

1. identify the affected journey;
2. identify meaningful observable behavior;
3. preserve synthetic/non-production data where possible;
4. use ECC `e2e-testing` when useful;
5. run focused Playwright/browser verification;
6. verify successful path;
7. verify meaningful failure/authorization path when relevant;
8. expand to broader E2E only when risk/scope requires it.

Important journeys include:

* registration;
* login;
* onboarding;
* password recovery;
* listing draft/publish;
* offers;
* favorites;
* chat;
* deal completion;
* reviews;
* reporting;
* moderation;
* admin;
* settings;
* account lifecycle.

Rendering the page alone is not enough when the behavior is a full journey.

---

# 14. Final verification

Use the **final risk class**, not the starting risk class.

Run the matrix in `AUTONOMY.md`.

Then invoke/apply:

* Superpowers `verification-before-completion`.

Verification must be fresh.

Read:

* command output;
* exit status;
* relevant state;
* final diff.

Do not infer:

* build from tests;
* security from build;
* hosted state from local state;
* deployment convergence from upload success;
* CI from local success.

Record concise evidence in the PR body.

Example:

```text
Verification
- focused regression test — PASS
- pnpm test:unit — PASS (<count if available>)
- pnpm check — PASS
- pnpm build — PASS
- pnpm db:lint — PASS (if applicable)
- pnpm db:test — PASS (<count if applicable>)
- browser flow — PASS (<flow>)
- engineering review — PASS / findings resolved
- security review — PASS / findings resolved
- GitHub CI — PASS
```

Do not paste:

* secrets;
* credentials;
* tokens;
* sensitive user data;
* unnecessarily large raw logs.

---

# 15. Completion claim discipline

Before saying:

* DONE;
* PASS;
* FIXED;
* GREEN;
* DEPLOYED;
* MERGED;
* MIGRATED;
* ROLLED BACK;

verify the claim itself.

Examples:

To claim `FIXED`:

* reproduce previous failure;
* prove changed behavior;
* run relevant regression coverage.

To claim `MERGED`:

* inspect actual PR/remote state.

To claim `DEPLOYED`:

* inspect actual deployment/provider state.

To claim hosted `PASS`:

* run/inspect the governing hosted evidence.

Do not convert:

> "the command succeeded"

into a broader claim than the command proves.

---

# 16. Pull request state

Every non-trivial ticket normally maps to one PR.

PR body includes:

* `Closes #<issue>` or equivalent issue linkage;
* final risk class;
* concise behavior change;
* acceptance criteria status;
* verification evidence;
* specialist reviews used;
* migrations involved;
* external/provider configuration involved;
* unresolved findings;
* explicit `None` when no unresolved material findings remain.

R2 PRs must be visibly identified as high risk.

R2 PRs must not be configured to auto-merge.

Do not ask for H3 before:

* implementation is complete;
* verification is complete;
* specialist reviews are complete;
* independent review is complete;
* CI is green.

---

# 17. CI repair loop

On CI failure:

1. inspect the actual failing workflow/job/log;
2. classify the failure;
3. reproduce locally when practical;
4. invoke Superpowers systematic debugging where applicable;
5. identify root cause;
6. make one materially justified repair;
7. run the focused local check;
8. push;
9. observe CI again.

Use:

* `gh-fix-ci` when available.

Otherwise inspect real GitHub Actions evidence through:

* GitHub integration;
* `gh`.

Budget:

> **3 materially different root-cause repair attempts.**

After three failed attempts:

* trigger H6;
* show evidence;
* show eliminated hypotheses;
* recommend next action.

Never:

* skip the failing check;
* lower branch protection;
* weaken tests;
* hide CI failure.

---

# 18. Implementation/test repair budget

For a focused failing implementation/test cycle:

* maximum 3 materially different evidence-based repair attempts;
* after the first unexpected failure, use systematic debugging rather than guessing;
* use Matt `diagnosing-bugs` for difficult causal analysis when useful;
* if the failure exposes a separate issue, ticket it;
* do not balloon current scope;
* if newly discovered work is R2/R3, do not bury it in R1.

A materially different attempt requires:

* a different evidence-backed hypothesis; or
* new evidence changing the diagnosis.

Changing arbitrary code in another location does not count.

After the budget is exhausted:

> trigger H6.

---

# 19. Review repair budget

For the same serious review finding:

* maximum 3 review/fix cycles;
* verify whether the finding is valid;
* identify actual root cause;
* fix the smallest safe surface;
* re-run affected verification;
* request focused re-review.

After the third unresolved cycle:

* trigger H6;
* provide competing evidence;
* explain remaining uncertainty;
* recommend path forward.

---

# 20. Hosted/staging ambiguity

For hosted/staging verification:

1. verify target identity;
2. verify target project/account/environment;
3. verify intended pre-state;
4. use synthetic data/accounts when possible;
5. perform only authorized mutations;
6. verify resulting state;
7. preserve required evidence.

Never assume an ambiguous:

* database;
* Supabase project;
* Worker;
* Cloudflare account;
* email provider;
* provider environment;

is staging.

Maximum:

> **2 evidence-based repair attempts**

when external state remains ambiguous.

Then trigger:

* H6 for exhausted technical investigation; or
* H4 when protected owner/provider action is required.

Do not solve ambiguity by making a broader provider mutation.

---

# 21. Provider/owner manual step

When a provider action requires owner involvement:

1. finish all safe investigation first;
2. determine the exact provider;
3. determine exact project/environment;
4. determine current state;
5. determine exact requested mutation;
6. determine expected post-state;
7. determine verification method;
8. determine rollback when relevant;
9. use Matt/repository `wizard` when available;
10. provide click-by-click instructions.

The instructions should explain:

* where to click;
* what exact setting/value to use;
* what not to touch;
* what confirmation to expect.

After owner action:

* independently verify state when possible.

Do not ask the owner to diagnose the problem.

The agent should diagnose first and ask only for the protected/manual action.

---

# 22. Merge behavior

## R0/R1

Auto-merge when and only when all requirements in `AUTONOMY.md` are satisfied.

Before auto-merge:

1. inspect final risk classification;
2. inspect final diff;
3. verify no Human Gate emerged;
4. verify all required checks/reviews;
5. verify CI;
6. verify mergeability.

If the final diff became R2:

> do not auto-merge.

Reclassify and follow R2.

## R2

Do all safe engineering first.

Then present H3.

Merge only after explicit owner approval.

## R3

Do not execute the protected action.

Use the applicable:

* H1;
* H2;
* H4;
* H5;

gate.

---

# 23. After merge

Automatically:

1. confirm the actual PR/merge result;
2. inspect resulting target branch SHA/state when relevant;
3. close/reconcile the GitHub Issue;
4. update `PROJECT-STATUS.md` only if the project's real state, blockers or next steps changed;
5. update `MASTER-PLAN.md` only when an owner decision or legitimate phase state changed;
6. avoid creating an extra task-result document for ordinary work;
7. safely clean completed worktree/feature branch where policy allows;
8. re-read the ready GitHub frontier;
9. continue to the next issue.

Do not leave:

* a merged issue marked active;
* a completed worktree unnecessarily;
* stale blocker text when authoritative project state changed.

Do not rewrite historical receipts merely because project state moved forward.

---

# 24. Gate-scoped operational work

When executing an explicit gate such as:

* A7;
* A8;
* A9;
* another named release/security gate;

the gate itself becomes the execution scope.

Do not silently substitute the general autonomous queue.

Sequence:

1. identify exact governing gate document;
2. identify exact authorized mutations;
3. identify exact prerequisite state;
4. identify stop conditions;
5. identify required evidence;
6. execute only that gate;
7. stop at the gate's defined completion/block boundary.

Example:

> `A9 only` means do not perform A8 cleanup, A10 preparation or unrelated provider work.

Generic staging permissions in `AUTONOMY.md` do not broaden a narrower gate.

---

# 25. Phase completion

When no active-phase work remains:

1. verify phase exit criteria;
2. reconcile issue state;
3. reconcile project-status state;
4. confirm no unresolved required gate is hidden;
5. inspect required final verification;
6. only then call the phase complete.

Output:

```text
PHASE COMPLETE
Phase: <name>
Completed: <major outcomes>
Verification: <key evidence>
Remaining owner gates: None / <gate>
Remaining known blockers: None / <blocker>
Next planned phase: <name or not yet approved>
```

Do not silently enter a materially new product phase if `MASTER-PLAN.md` or another authority requires owner approval.

---

# 26. Phase/gate status precedence

When sources disagree, do not blindly trust whichever file was read first.

For current operational status, consider:

1. explicit current owner instruction;
2. approved current gate/plan;
3. verified hosted/provider receipts;
4. merged repository/git state;
5. current GitHub issue/PR state;
6. `PROJECT-STATUS.md`;
7. older historical audit/status documents.

This precedence is for establishing **current factual state**.

It does not allow an agent to override documented owner product/legal decisions.

If authoritative sources materially conflict:

* identify the conflict;
* reconcile mechanically when safe;
* otherwise trigger the appropriate Human Gate.

---

# 27. Subagent execution

Use subagents when work can be cleanly decomposed.

Preferred Superpowers workflow:

* `subagent-driven-development`.

Good parallel tasks include:

* independent code exploration;
* independent security review;
* independent test review;
* independent documentation research;
* non-overlapping implementation slices.

Avoid parallel agents modifying the same tightly coupled files unless coordination is explicit.

Every subagent receives:

* exact task;
* allowed scope;
* risk class;
* relevant invariants;
* governing spec/gate;
* expected evidence;
* stop conditions.

Subagent output is not automatically trusted.

The parent agent verifies:

* surprising claims;
* code changes;
* test evidence;
* provider claims.

The parent agent owns the final completion claim.

---

# 28. Workflow anti-patterns

Do not:

```text
Superpowers brainstorming
→ another planner
→ ECC planner
→ writing-plans
```

Use:

```text
Superpowers brainstorming
→ specialist technical input if needed
→ Superpowers writing-plans
```

Do not:

```text
Superpowers systematic-debugging
→ random patches
→ Matt diagnosing-bugs afterward
```

Use:

```text
Superpowers systematic-debugging
+ Matt diagnosing-bugs where useful
→ proven root cause
→ regression test
→ fix
```

Do not:

```text
Superpowers TDD
→ Matt TDD
→ ECC TDD
```

Use:

```text
Superpowers TDD
+ specialist testing expertise
```

Do not:

```text
three generic reviewers
```

Use:

```text
one independent engineering review
+ specialist review when triggered
```

Do not:

```text
local green
→ claim staging green
```

Use:

```text
local evidence
→ hosted evidence
→ actual hosted PASS
```

---

# 29. Final execution principle

The autonomous loop should optimize for:

* progress without unnecessary interruption;
* narrow scope;
* root-cause reasoning;
* small reversible changes;
* one process owner;
* targeted specialist expertise;
* adversarial review for risky surfaces;
* fresh verification;
* accurate current-state reconciliation.

The goal is not maximum agent activity.

The goal is:

> **maximum safe, independently verifiable progress before a real Human Gate is required.**

Therefore:

**Superpowers drives the process.
Matt deepens engineering reasoning.
ECC adds specialist expertise.
Repository policy controls all three.
Evidence decides completion.**
