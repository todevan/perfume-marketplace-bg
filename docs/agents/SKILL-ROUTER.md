# Skill Router

## Purpose

Use exactly one primary process workflow and add specialist skills only when their trigger applies.

Avoid:

- duplicate planners;
- duplicate TDD loops;
- duplicate debugging methodologies;
- duplicate completion protocols;
- duplicate generic review workflows.

**Primary process owner: Superpowers.**

Engineering-depth specialists: **Matt Pocock skills.**

Narrow technical specialists: **ECC/repository-local skills and external integrations.**

Repository authority, approved specifications, current owner instructions, risk classification and Human Gates always outrank generic skill defaults.

---

## Authority model

Use this hierarchy when selecting skills:

### 1. Repository authority

Determines:

- allowed scope;
- product decisions;
- architecture constraints;
- security invariants;
- risk classification;
- Human Gates;
- merge permissions;
- release/provider restrictions;
- evidence requirements.

Primary sources include:

- root `AGENTS.md`;
- `docs/MASTER-PLAN.md`;
- `docs/PROJECT-STATUS.md`;
- approved gate/spec/plan documents;
- `docs/agents/AUTONOMY.md`;
- `docs/agents/EXECUTION-LOOP.md`;
- `docs/agents/HUMAN-GATES.md`;
- issue acceptance criteria.

### 2. Superpowers — process authority

Superpowers determines HOW non-trivial engineering work proceeds.

Use Superpowers for:

- brainstorming;
- planning;
- systematic debugging;
- TDD;
- worktree isolation;
- task execution;
- review workflow;
- receiving review;
- verification;
- branch completion.

### 3. Matt Pocock — engineering-depth authority

Matt skills deepen the technical reasoning inside the Superpowers lifecycle.

Preferred Matt skills:

- `diagnosing-bugs`;
- `domain-modeling`;
- `codebase-design`;
- `code-review`;
- `wizard`;
- `writing-for-agents`.

Matt skills must not create a second competing process lifecycle.

### 4. ECC / repository-local / integrations — specialist authority

Use specialist skills for narrow expertise.

Preferred ECC specialist roles include:

- `security-review`;
- `backend-patterns`;
- `e2e-testing`;
- `eval-harness`;
- `documentation-lookup`.

Other repository-local UI, GitHub, Supabase, Cloudflare and platform skills remain available when their specialist trigger applies.

---

## Routing table

| Situation | Required route | Notes |
| --- | --- | --- |
| Fresh session | `using-superpowers` + repository startup protocol | Read repository authority before work selection. |
| New behavior with insufficient spec | Superpowers `brainstorming` | Reversible technical design choices are standing-approved by `AGENTS.md`; stop only for a real Human Gate. |
| Approved spec needing task breakdown | Superpowers `writing-plans` | Do not create a competing specification. |
| Approved plan ready to execute | Superpowers `subagent-driven-development` preferred, otherwise `executing-plans` | Execute task-by-task with review gates. |
| Bug or unexpected behavior | Superpowers `systematic-debugging`; Matt `diagnosing-bugs` may assist | Root cause before fix. |
| Behavior implementation | Superpowers `test-driven-development` | One TDD lifecycle only. Specialist testing skills may advise test design but do not own the lifecycle. |
| Implementation from existing tickets | repository/Matt `implement` may assist when installed | It operates inside the Superpowers execution lifecycle and must not become a second process owner. |
| Independent code review | Superpowers `requesting-code-review`; Matt `code-review` preferred for detailed review | Review both specification compliance and engineering standards. |
| Security review | ECC `security-review` or strongest available security specialist | Additional specialist review; does not replace ordinary independent review. |
| Review feedback | Superpowers `receiving-code-review` | Verify feedback technically; no performative agreement. |
| Completion claim | Superpowers `verification-before-completion` | Fresh inspected evidence required. |
| Branch completion | Superpowers `finishing-a-development-branch` | Follow repository risk/merge policy. |
| Isolated non-trivial work | Superpowers `using-git-worktrees` + repository git guardrails | Never discard unknown work. |
| Convert approved plan/spec to GitHub work | repository `to-tickets` when useful | Produce vertical slices, dependencies, acceptance criteria and risk/priority labels. |
| Unclear issue quality/frontier | repository `triage` | GitHub Issues remain the canonical executable queue. |
| Large/unknown initiative | repository `wayfinder` when useful | Map unknowns until executable tasks emerge; Human Gate for owner decisions only. |
| External setup requiring owner | Matt/repository `wizard` | Give click-by-click instructions and verify after each protected step. |
| Agent-facing docs/instructions | Matt `writing-for-agents` | Preserve repository authority and avoid duplicated rules. |
| Significant UI/UX change | repository `ui-ux-pro-max`; optionally `ui-styling` / `design-system` | `DESIGN.md` and existing UI language remain authoritative. |
| Architecture/module-boundary question | Matt `codebase-design`; ECC `backend-patterns` may assist | Do not trigger broad unrelated refactors. |
| Domain-state/invariant question | Matt `domain-modeling` | Clarify terminology, states and invariants before implementation. |
| Security-sensitive change | ECC `security-review` + deterministic security checks | Mandatory specialist layer for R2 security/auth/privacy surfaces. |
| Supabase/Postgres/RLS change | Supabase integration when available + DB tests/lint | Inspect real schema/policies/functions, not only TypeScript. |
| Cloudflare Worker/runtime/deploy change | Cloudflare integration when available | Use platform-correct runtime/deployment evidence. |
| User-facing journey change | ECC `e2e-testing` + Playwright/browser verification when useful | Exercise the affected journey rather than merely rendering a page. |
| Explicit evaluation problem | ECC `eval-harness` | Use only where ordinary unit/integration/E2E tests do not adequately express success criteria. |
| External library/API documentation | ECC `documentation-lookup` + primary documentation | Prefer current primary sources rather than memory. |
| GitHub CI failure | `gh-fix-ci` if available; otherwise inspect real GitHub Actions logs via GitHub/`gh` | Three evidence-based repair attempts max. |
| PR review comments | `gh-address-comments` if available + Superpowers `receiving-code-review` | Resolve only valid feedback. |

---

## Duplicate workflow prevention

Installed skills are composable tools, not permission to run every methodology.

### Planning

Primary:

- Superpowers `brainstorming`;
- Superpowers `writing-plans`.

Do not run a second Matt/ECC generic planning workflow for the same task.

Matt `codebase-design` and `domain-modeling` may contribute technical input to the Superpowers plan.

### TDD

Primary:

- Superpowers `test-driven-development`.

Do not run:

- Superpowers TDD;
- Matt/repository TDD;
- ECC `tdd-workflow`;

as three independent loops.

If another installed TDD skill contains useful test-design advice, consult that advice only. Superpowers remains the lifecycle owner.

### Debugging

Primary:

- Superpowers `systematic-debugging`.

Deep technical assistance:

- Matt `diagnosing-bugs`.

Domain specialist assistance may be added when appropriate.

Do not jump directly from symptom to speculative patch.

### Implementation

Primary execution lifecycle:

- Superpowers `subagent-driven-development`; or
- Superpowers `executing-plans`.

A repository/Matt `implement` skill may assist with implementation mechanics when useful but does not replace the approved plan or execution lifecycle.

### Review

Process:

- Superpowers `requesting-code-review`.

Detailed engineering review:

- Matt `code-review`.

Specialist security review:

- ECC `security-review`.

These reviews may coexist because they have different responsibilities.

Do not run several generic reviewers that merely repeat the same checklist.

### Verification

Primary:

- repository risk verification requirements;
- Superpowers `verification-before-completion`.

Do not run an ECC/repository generic verification loop as a competing definition of DONE.

The repository evidence requirements are authoritative.

---

## Superpowers autonomy override

Superpowers remains mandatory where applicable, but the owner has provided standing repository-level approval for reversible technical decisions.

Therefore:

- do not ask the owner to approve a technical choice already determined by repo patterns/spec/acceptance criteria;
- do not ask the owner to confirm an obvious test seam when the public behavior is defined;
- do not re-brainstorm an already approved specification;
- do not request generic approval after every design section when all choices are reversible and repository-authorized;
- do not stop between plan tasks merely for routine permission;
- do not create a second approval gate merely because a generic skill normally contains one;
- do stop when H1/H2/H3/H4/H5/H6 applies.

When a Superpowers skill contains a generic human-approval checkpoint for a reversible technical decision, the standing approval in root `AGENTS.md` satisfies that checkpoint after the agent performs the required self-review.

This exception does not authorize:

- owner-only product decisions;
- legal/privacy/business decisions;
- R2 merge approval;
- R3 protected operations;
- destructive actions;
- credential/provider actions that require H4.

This is an owner instruction and therefore outranks generic skill defaults.

---

## Matt Pocock specialist rules

Matt skills are used for engineering depth rather than orchestration.

### `diagnosing-bugs`

Use when:

- causal chain is unclear;
- multiple layers may contribute to the failure;
- performance changed unexpectedly;
- local evidence contradicts the expected architecture;
- an ordinary debugging pass does not explain the behavior.

It operates inside Superpowers `systematic-debugging`.

### `domain-modeling`

Use when:

- states or transitions are unclear;
- terminology is overloaded;
- invariants are difficult to express;
- business/domain behavior crosses several modules;
- a state machine would clarify correctness.

Repository-approved product behavior remains authoritative.

### `codebase-design`

Use when:

- introducing or changing module boundaries;
- choosing an interface;
- deciding where behavior belongs;
- avoiding duplicated responsibilities;
- designing a meaningful abstraction.

It must not justify unrelated refactoring.

### `code-review`

Use for detailed engineering review after implementation.

Review at minimum:

- specification compliance;
- correctness;
- architecture;
- security implications;
- maintainability;
- unnecessary complexity;
- tests;
- regression risk.

### `wizard`

Use when the owner must perform a manual step in:

- Supabase dashboard;
- Cloudflare;
- GitHub;
- email provider;
- DNS;
- credentials/secrets;
- another protected third-party system.

Instructions should be:

- exact;
- sequential;
- human-readable;
- explicit about target environment;
- explicit about what NOT to touch.

After the owner performs the action, verify independently when tooling permits.

### `writing-for-agents`

Use when editing:

- `AGENTS.md`;
- `docs/agents/*`;
- local skills;
- agent instructions;
- subagent operating documents.

Prefer concise durable rules over duplicated long-form instructions.

---

## ECC specialist rules

ECC specialists supplement the process.

### `security-review`

Use for explicit adversarial/security review.

It is mandatory for materially security-sensitive R2 surfaces when available.

### `backend-patterns`

Use when evaluating server/backend structure, data flow or service boundaries.

Matt `codebase-design` remains preferred when the core question is module/interface design.

ECC `backend-patterns` is useful for backend-specific implementation patterns.

### `e2e-testing`

Use when:

- browser flow behavior matters;
- Playwright structure is involved;
- cross-page/session behavior is being tested;
- user journey coverage needs design.

It supplements Superpowers TDD rather than replacing it.

### `eval-harness`

Use only when ordinary deterministic tests are insufficient.

Examples:

- comparing behavior across several representative cases;
- explicit scoring/acceptance harnesses;
- evaluating non-trivial generated or heuristic outputs.

Do not build an eval harness for ordinary deterministic application logic that a normal test can express.

### `documentation-lookup`

Use for:

- external libraries;
- APIs;
- platform constraints;
- recent framework/provider behavior.

Prefer primary documentation.

Do not rely on remembered API behavior when current documentation can be checked.

---

## Security specialist trigger

Mandatory specialist security review when changes touch materially:

- auth/session/registration/reset/MFA;
- RLS/authorization/privileged access;
- admin/moderator authorization;
- private user data or Storage;
- upload/evidence trust boundaries;
- reports/blocking/moderation/retention;
- secrets/security configuration;
- account deletion/export/anonymization;
- webhook/email disclosure or duplication risks;
- cross-user visibility;
- service-role use;
- `SECURITY DEFINER`;
- security-sensitive provider configuration.

Preferred specialist:

- ECC `security-review`, when installed and applicable.

If a stronger Codex Security capability is available, it may supplement the review.

If the intended security specialist is unavailable in the current environment:

- do not pretend it ran;
- use available code-review/security tooling;
- run deterministic tests/scans;
- document the missing specialist;
- escalate only if the required security confidence cannot otherwise be achieved.

---

## Supabase/PostgreSQL specialist trigger

Mandatory when touching:

- `supabase/migrations/`;
- RLS policies;
- SQL functions/triggers;
- `SECURITY DEFINER`;
- Storage authorization;
- service-role repositories;
- schema ownership/invariants.

Required deterministic evidence as applicable:

- `pnpm db:lint`;
- `pnpm db:test`;
- `pnpm test:db:contracts`;
- local migration/reset from scratch;
- hostile-client tests when authorization boundaries change;
- hosted checks only against a verified non-production target unless H4 authorizes production.

Never infer database authorization correctness only from TypeScript/application behavior.

---

## Cloudflare specialist trigger

Use for:

- Worker compatibility/runtime behavior;
- request/memory/platform limits;
- secrets/bindings;
- staging/production deployment;
- rollback/version compatibility;
- scheduled tasks;
- Cloudflare-specific infrastructure;
- traffic/version convergence.

A successful deployment command alone is not proof that the intended Worker version serves traffic.

Use hosted verification required by the governing gate.

---

## UI/UX trigger

For changes affecting how a user sees, understands or interacts with a screen:

- preserve `DESIGN.md`;
- preserve the current marketplace visual language;
- use existing components/patterns where appropriate;
- run accessibility checks appropriate to the change;
- prefer component tests for isolated behavior;
- use browser/E2E verification for complete journeys;
- do not redesign unrelated areas while touching a large component;
- extract a component opportunistically only when it makes the current change safer or clearer.

Preferred specialist skills when installed:

- `ui-ux-pro-max`;
- `ui-styling`;
- `design-system`.

These skills do not override `DESIGN.md`.

---

## Browser verification trigger

Mandatory for materially changed flows such as:

- registration;
- login;
- onboarding;
- password recovery;
- listing wizard;
- listing draft/publish;
- listing detail;
- offers;
- favorites;
- chat;
- deal completion;
- reviews;
- reporting;
- moderation;
- admin;
- settings;
- account lifecycle.

Use synthetic/non-production data where possible.

For browser-test architecture or Playwright-specific issues, ECC `e2e-testing` may assist.

---

## External provider/manual action trigger

For provider operations involving:

- Supabase;
- Cloudflare;
- Turnstile;
- email providers;
- GitHub repository settings;
- DNS;
- secrets;
- production environment;
- destructive hosted operations;

first determine:

1. exact provider;
2. exact account/project;
3. exact environment;
4. exact desired pre-state;
5. exact requested mutation;
6. whether H4/H5 applies;
7. verification method;
8. rollback path where relevant.

When owner action is required, use Matt/repository `wizard` if available.

Never tell the owner to click a vague setting without identifying the target and expected result.

---

## GitHub automation

GitHub Issues are the canonical executable engineering queue.

Feature work should link commits/PRs to the issue.

When CI or review fails:

- inspect actual evidence;
- determine root cause;
- perform evidence-based repair;
- never lower branch protections;
- never skip required checks;
- never weaken tests merely to make the PR mergeable.

For CI:

- use `gh-fix-ci` when available;
- otherwise inspect real GitHub Actions jobs/logs via GitHub/`gh`.

For review comments:

- use `gh-address-comments` when available;
- apply Superpowers `receiving-code-review` discipline;
- independently verify reviewer claims before modifying code.

---

## Specialist composition examples

### Normal feature

Use:

1. Superpowers process.
2. Matt `domain-modeling` / `codebase-design` only if needed.
3. Superpowers TDD.
4. Implementation.
5. Matt `code-review`.
6. Superpowers verification.

Do not add ECC unless a specialist trigger exists.

### Difficult bug

Use:

1. Superpowers `systematic-debugging`.
2. Matt `diagnosing-bugs`.
3. Regression test.
4. Superpowers TDD.
5. Repair.
6. Review.
7. Superpowers verification.

### Auth/RLS/security change

Use:

1. Superpowers process.
2. Matt design/domain expertise if needed.
3. Database/security tests.
4. ECC `security-review`.
5. Matt/general independent code review.
6. Full R2 verification.
7. H3 before merge.

### Browser-flow regression

Use:

1. Superpowers `systematic-debugging`.
2. ECC `e2e-testing`.
3. Regression test.
4. Superpowers TDD.
5. Repair.
6. Browser verification.
7. Review.
8. Superpowers verification.

### Provider configuration problem

Use:

1. Establish provider truth.
2. Systematic debugging if behavior is unexpected.
3. Current primary provider documentation.
4. Matt `wizard` if owner action is required.
5. Owner performs protected step.
6. Verify resulting provider state.
7. Record evidence required by the gate.

---

## Routing anti-patterns

Do not do:

`brainstorming → Matt planner → ECC planner → writing-plans`

Use:

`Superpowers brainstorming → specialist design input if needed → Superpowers writing-plans`

Do not do:

`Superpowers TDD → Matt TDD → ECC tdd-workflow`

Use:

`Superpowers TDD + specialist advice`

Do not do:

`systematic-debugging → random patch → diagnosing-bugs afterward`

Use:

`systematic-debugging + Matt diagnosing-bugs → proven root cause → regression test → fix`

Do not do:

`code-review + security-review + three generic reviewers`

Use:

`one independent engineering review + specialist security review when triggered`

Do not do:

`local tests green → claim hosted PASS`

Use:

`local verification → actual hosted verification → evidence → PASS`

---

## Final routing rule

When uncertain which skill to invoke, ask:

1. Is this about **process**?
   - Use Superpowers.

2. Is this about **deep software-engineering reasoning**?
   - Use Matt Pocock.

3. Is this about a **specific technical specialty**?
   - Use ECC/repository/platform specialist.

4. Is there already an approved project rule/spec/gate?
   - Follow it instead of creating a new workflow.

5. Would another skill duplicate the lifecycle already running?
   - Do not invoke it.

**One process owner.
Specialists compose underneath it.
Repository authority controls them all.**
