# AGENTS.md

## Purpose

Guide autonomous engineering work for this SvelteKit, TypeScript, Supabase and Cloudflare Worker marketplace.

The project owner is not expected to act as the programmer. Agents should make reversible technical decisions, execute engineering work, verify it, review it, and continue to the next ready task without unnecessary owner interruption. Human involvement is reserved for the gates defined below.

This repository uses a unified Codex engineering stack:

* **Repository instructions** define project authority, scope, risk and release rules.
* **Superpowers** is the primary process authority.
* **Matt Pocock skills** provide engineering-depth reasoning inside that process.
* **ECC skills** provide narrow specialist expertise.
* Installed skills are tools. They do not override repository scope, owner decisions, security boundaries or release gates.

The purpose of this separation is to combine the strongest parts of each system without running multiple competing planning, TDD, debugging, review or verification workflows for the same task.

---

## Authority hierarchy

When instructions conflict, use this order:

1. Explicit current owner instruction.
2. This root `AGENTS.md`.
3. Current product/phase decisions in `docs/MASTER-PLAN.md` and `docs/PROJECT-STATUS.md`.
4. Architecture, launch, security and operational documentation under `docs/`.
5. `docs/agents/AUTONOMY.md`, `EXECUTION-LOOP.md`, `SKILL-ROUTER.md`, `HUMAN-GATES.md`, and `issue-tracker.md`.
6. Approved task/spec/issue acceptance criteria.
7. Superpowers and repository-local/external skills.
8. Generic agent defaults.

Repository instructions and owner decisions override generic skill defaults.

An installed skill may define how to investigate or implement something, but it may not silently broaden the authorized scope of work.

If a generic skill conflicts with a repository security rule, release gate, approved specification or owner decision, follow the repository-specific rule.

Never silently resolve a material conflict involving:

* authentication;
* authorization;
* MFA/AAL;
* RLS;
* privacy;
* cross-user visibility;
* evidence;
* production;
* staging providers;
* database mutations;
* releases;
* rollback;
* credentials;
* destructive infrastructure.

Report the exact conflict before performing the conflicting mutation.

---

## Unified skill authority

### Repository layer — project authority

This `AGENTS.md` and the authoritative project documents determine:

* what may be changed;
* what must remain unchanged;
* current product decisions;
* security invariants;
* phase and gate boundaries;
* owner-only decisions;
* risk classification;
* merge permissions;
* production/provider permissions;
* required evidence.

No external skill can override this layer.

### Superpowers — process authority

Superpowers owns the engineering process for non-trivial work.

Use the relevant Superpowers workflow before acting when applicable.

Typical Superpowers responsibilities include:

* brainstorming;
* specification development;
* writing implementation plans;
* systematic debugging;
* test-driven development;
* isolated worktree setup;
* implementation execution;
* code-review workflow;
* responding to review findings;
* verification before completion;
* branch completion.

Superpowers determines the sequence of work.

Other skill systems may contribute expertise inside that sequence but must not replace it with a second competing end-to-end workflow.

### Matt Pocock — engineering-depth authority

Matt Pocock skills provide deeper software-engineering reasoning inside the Superpowers process.

Prefer Matt skills for areas such as:

* difficult bug diagnosis;
* domain modeling;
* codebase/module design;
* interface and boundary design;
* implementation review;
* agent-facing documentation;
* human-executable provider/dashboard instructions.

Preferred Matt roles when installed include:

* `diagnosing-bugs`;
* `domain-modeling`;
* `codebase-design`;
* `code-review`;
* `wizard`;
* `writing-for-agents`.

Matt skills do not replace applicable Superpowers process gates.

Examples:

* For a bug, Superpowers `systematic-debugging` owns the investigation process; Matt `diagnosing-bugs` may deepen causal analysis.
* For architecture, Superpowers owns brainstorming/planning; Matt `codebase-design` may refine module boundaries.
* For domain logic, Matt `domain-modeling` may clarify invariants before the Superpowers implementation plan.
* For review, the project/Superpowers workflow determines when review occurs; Matt `code-review` may provide detailed engineering review.

Do not run Matt's separate full planning/TDD process in parallel with Superpowers when both are installed.

### ECC — specialist authority

ECC is a specialist toolbox, not the primary workflow owner.

Prefer ECC only where a narrow specialist skill adds expertise beyond the project/Superpowers/Matt layers.

Preferred ECC specialist areas include:

* security review;
* backend architecture patterns;
* E2E/Playwright testing;
* explicit evaluation harnesses;
* external documentation lookup.

Preferred ECC skills when installed include:

* `security-review`;
* `backend-patterns`;
* `e2e-testing`;
* `eval-harness`;
* `documentation-lookup`.

ECC must not become a second generic planning, TDD, verification or orchestration framework.

Avoid running ECC generic workflow equivalents when a Superpowers workflow already owns the task.

---

## Duplicate workflow prevention

Never stack multiple complete methodologies merely because they are installed.

Use one process owner.

### Planning

Use:

* Superpowers brainstorming/specification/planning.

Do not also run an independent Matt or ECC planning framework for the same task unless the repository explicitly replaces the Superpowers process.

### TDD

Use:

* Superpowers test-driven-development.

Matt or ECC may provide domain/security/testing expertise, but they must not run a second independent TDD lifecycle.

### Debugging

Use:

* Superpowers systematic-debugging as the process owner.

Use Matt `diagnosing-bugs` when deeper causal reasoning is useful.

Use ECC specialist skills only when the bug clearly belongs to their specialist domain.

### Review

Use the repository-required independent review process.

Matt `code-review` is preferred for detailed engineering review.

ECC `security-review` may run as an additional specialist review for security-sensitive work.

Specialist review supplements normal review; it does not replace it.

### Verification

Use:

* repository verification requirements;
* the applicable risk-class matrix;
* Superpowers verification-before-completion.

Do not run multiple generic completion loops that generate conflicting definitions of DONE.

The repository's required evidence is the final completion authority.

---

## Skill routing examples

### New feature

Default sequence:

1. Read project and issue/spec context.
2. Classify risk.
3. Superpowers brainstorming if behavior is not already sufficiently specified.
4. Matt `domain-modeling` or `codebase-design` if useful.
5. Superpowers implementation planning.
6. Superpowers TDD.
7. Implement.
8. Relevant specialist review.
9. Independent code review.
10. Superpowers verification-before-completion.
11. Apply merge rules for the issue risk class.

### Bug

Default sequence:

1. Reproduce the failure.
2. Superpowers systematic-debugging.
3. Matt `diagnosing-bugs` when useful.
4. Identify root cause.
5. Add a failing regression test where practical.
6. Superpowers TDD for the fix.
7. Implement smallest safe repair.
8. Review.
9. Fresh verification.
10. Complete only when evidence proves the failure is resolved.

### Security-sensitive change

Default sequence:

1. Establish exact security boundary.
2. Classify R2 where applicable.
3. Superpowers process.
4. Matt design/domain reasoning when useful.
5. Implement with hostile-client/security tests where applicable.
6. ECC `security-review`.
7. Independent code review.
8. Full relevant R2 verification.
9. Stop at Human Gate H3 before merge.

### E2E/browser regression

Default sequence:

1. Superpowers systematic-debugging.
2. ECC `e2e-testing` for specialist Playwright/browser guidance.
3. Regression test.
4. Repair.
5. Narrow E2E verification.
6. Broader verification if required by risk/change surface.
7. Final independent verification.

### Provider/dashboard/manual owner step

Default sequence:

1. Establish exact target provider/project/environment.
2. Establish exact intended mutation.
3. Determine whether H4 or another Human Gate applies.
4. Matt `wizard` may prepare exact human-executable steps.
5. Owner performs the protected action when required.
6. Agent independently verifies resulting provider state when tools permit.
7. Record evidence required by the governing gate.

---

## Global invariants

* Favor the existing server-first architecture: routes and server actions coordinate requests, services enforce rules, repositories access data, and domain code holds deterministic marketplace logic.
* Keep the pre-launch and privacy constraints intact. Regular-user email/password registration is public by owner decision; do not reintroduce invitation or phone-verification gates unless the owner changes that decision.
* In `src/AGENTS.md`, the phone-verification watchpoint applies only to privileged or explicitly retained verification paths; it does not authorize a regular-user phone gate.
* Do not enable public profile writes, payments, boosts, ads or other monetization paths unless explicitly authorized by the owner.
* Protect confidential data. Never log or publish secrets, auth tokens, phone numbers, emails, raw profile content, private evidence or credential-bearing command output.
* Do not edit existing Supabase migrations. If schema changes are required, add a new forward-only migration and keep the existing migration history intact.
* Do not weaken RLS, authorization, tests or release gates merely to make a change pass.
* Do not use service-role privileges as a convenience shortcut around normal authorization boundaries.
* Prefer small, reversible changes and validate them with the narrowest relevant command first.
* Security-sensitive failure modes must fail closed.
* Never invent provider state.
* Never invent hosted evidence.
* Never claim a deployment, migration, rollback, smoke test or provider change occurred without evidence.
* Do not turn inference into PASS.
* Do not broaden a scoped gate because an unrelated nearby issue appears easy to fix.

---

## Module map

* `src/routes`: page and endpoint entrypoints, route guards and HTTP semantics.
* `src/lib/server`: services, repositories, auth helpers and workflow logic.
* `src/lib/domain`: marketplace rules and deterministic decision logic.
* `src/lib/contracts`: Zod contracts and stable DTOs shared across UI/server boundaries.
* `supabase/`: SQL migrations, functions, RLS and test fixtures.
* `scripts/`: operational tools for backup, seeding, staging and readiness checks.
* `tests/`: unit, component, contract and end-to-end coverage.
* `docs/`: authoritative product, architecture, operational and agent documentation.

Keep UI components presentation-oriented where practical.

Business, security and authorization rules belong behind trusted server/database/domain boundaries rather than browser-only checks.

---

## Engineering principles

Prefer:

* explicit domain types;
* validated external input;
* narrow interfaces;
* clear module boundaries;
* deterministic domain logic;
* discriminated unions for meaningful state machines;
* exhaustive handling of important states;
* primary-source documentation for external systems;
* existing project patterns over unnecessary abstractions;
* reversible changes;
* narrow feedback loops;
* evidence over inference.

Avoid:

* `any` as a casual escape hatch;
* duplicated validation;
* boolean parameter explosions;
* hidden global state;
* unrelated refactors;
* swallowing important errors;
* application-only authorization where the database is an authorization boundary;
* weakening protections to satisfy tests;
* speculative abstractions unrelated to the current issue.

---

## Autonomous-by-default policy

After session startup, proceed automatically with the highest-priority executable issue in the active phase.

Do not ask the owner to approve ordinary engineering steps such as:

* reading files;
* inspecting code;
* selecting an existing pattern;
* creating tests;
* creating a worktree;
* editing source;
* making reversible technical design decisions;
* committing;
* pushing a feature branch;
* opening a PR;
* fixing CI;
* addressing valid review feedback;
* updating current engineering documentation.

The owner has given standing approval for agents to make **reversible technical design decisions** when the repository, approved specification, issue acceptance criteria or established architecture provides enough information.

If a generic skill would normally ask the owner to approve such a reversible technical design, treat this standing repository instruction as approval after the agent has self-reviewed the design.

The user's current explicit prompt counts as authorization for the scope clearly stated in that prompt.

Do not require a second generic confirmation merely because a generic workflow would normally request one.

This standing approval does **not** apply when a Human Gate is triggered.

---

## Risk classification

Classify every executable issue before implementation.

### R0 — trivial/documentation

Examples:

* non-policy copy fixes;
* current engineering-documentation reconciliation;
* formatting-only work;
* test-description cleanup.

Rules:

* Fully autonomous.
* May auto-merge after narrow appropriate verification and review when useful.

### R1 — normal engineering

Examples:

* component tests;
* ordinary UI/accessibility work;
* non-security bug fixes;
* safe refactors covered by tests;
* behavior changes inside existing authorization boundaries.

Rules:

* Fully autonomous.
* May auto-merge only after required verification, independent review and CI are green.

### R2 — high-risk engineering

R2 includes changes that materially touch:

* authentication;
* sessions;
* registration;
* password recovery;
* MFA;
* onboarding admission;
* membership authorization;
* RLS;
* authorization predicates;
* `SECURITY DEFINER`;
* privileged/service-role access;
* staff/admin/moderator permissions;
* privacy;
* cross-user visibility;
* private Storage;
* evidence-upload security;
* account deletion/export/retention;
* blocking;
* reporting;
* moderation;
* evidence rules;
* security-sensitive secrets/configuration;
* migrations affecting existing data/authorization/privacy/invariants;
* release/rollback compatibility;
* any path that could expose one user's confidential data to another.

Rules:

* Implementation, tests, specialist review, PR creation and CI repair are autonomous.
* **Merge requires Human Gate H3 owner approval.**

### R3 — owner action / production or policy gate

Examples:

* production migrations;
* production destructive actions;
* secret rotation/revelation;
* DNS/provider changes with material consequences;
* payment/monetization activation;
* legal/privacy/retention decisions;
* destructive infrastructure operations;
* bulk customer communication.

Rules:

* Agents may prepare scripts, dry-runs, backups, rollback plans and step-by-step instructions.
* The protected action itself requires owner involvement.

Full definitions: `docs/agents/AUTONOMY.md`.

---

## Human Gates

Agents stop only for these conditions:

* **H1 Product behavior decision:** current docs do not determine between materially different user experiences.
* **H2 Legal/privacy/business decision:** correctness is not purely technical.
* **H3 High-risk merge approval:** an R2 PR is fully implemented and verified and is ready to merge.
* **H4 Production/credential action:** protected production/provider state or credentials require owner action/approval.
* **H5 Destructive/irreversible operation:** production deletion, protected history rewrite, infrastructure destruction or similar.
* **H6 Automation exhausted:** configured repair attempts are exhausted without a safe verified resolution.

Do not interrupt the owner before all safe autonomous work has been completed.

Use the plain-language templates in `docs/agents/HUMAN-GATES.md`.

A skill must not create additional owner gates merely because its generic workflow normally asks for confirmation.

Repository Human Gates are authoritative.

---

## Session start protocol

At the start of every repository session:

1. Read this file in full.
2. Read `docs/MASTER-PLAN.md` and `docs/PROJECT-STATUS.md` in full.
3. Read `docs/agents/AUTONOMY.md`, `docs/agents/EXECUTION-LOOP.md`, `docs/agents/SKILL-ROUTER.md`, `docs/agents/HUMAN-GATES.md`, and `docs/agents/issue-tracker.md`.
4. If the user references a gate, implementation plan, receipt, incident, PR, commit SHA, deployment or specific document, read that source before acting.
5. Inspect Git status, the current branch/worktree, and recent merged work relevant to the active phase.
6. Inspect the GitHub Issues frontier and reconcile obviously stale issue state against merged code/PRs.
7. Do not assume `PROJECT-STATUS.md` is current when newer git history, approved gate documentation or verified hosted evidence proves otherwise.
8. Select the highest-priority executable issue whose dependencies are complete.
9. Classify the issue R0/R1/R2/R3.
10. Send one concise progress update naming the active phase, selected issue and risk class.
11. Begin automatically unless a Human Gate is already known.

Preferred owner command:

> Continue autonomous development according to AGENTS.md until the active phase is complete or you hit a human gate.

---

## Workflow and skill precedence

* Superpowers is the primary process owner for non-trivial feature, bug-fix and implementation work.
* Do not run multiple overlapping planning/TDD/debugging/completion frameworks for the same task.
* Matt Pocock skills are engineering-depth specialists operating inside the Superpowers process.
* ECC-style skills are narrow specialists operating inside the Superpowers process.
* Route skills deterministically using `docs/agents/SKILL-ROUTER.md`.
* If an approved specification or detailed issue already defines behavior, do not create a competing specification. Reference the existing source of truth.
* For a new behavior without sufficient specification, use Superpowers brainstorming.
* Reversible technical choices are pre-approved by this file after appropriate self-review.
* Stop only if H1/H2 or another Human Gate is triggered.
* For bugs, use Superpowers systematic debugging before proposing a fix.
* Use Matt `diagnosing-bugs` when deeper causal reasoning is useful.
* For behavior changes, use Superpowers TDD at the narrowest meaningful public seam.
* For architecture/module-boundary questions, use Matt `codebase-design` when useful.
* For domain-state/invariant questions, use Matt `domain-modeling` when useful.
* For security-sensitive work, add ECC `security-review` when available.
* For E2E/Playwright specialist work, use ECC `e2e-testing` when available.
* For external API/library research, prefer ECC `documentation-lookup` when available and use primary sources.
* For non-trivial work, use an isolated feature branch/worktree unless the environment makes that impossible; never discard unknown work.
* Before completion, use independent code review and fresh verification evidence.
* Before declaring success, use Superpowers verification-before-completion or the equivalent installed verification skill required by the active Superpowers workflow.

---

## Git permissions

Without separate owner approval, agents may:

* create feature branches/worktrees;
* make scoped commits;
* push feature branches;
* open/update PRs;
* repair CI failures;
* address valid review feedback;
* auto-merge R0/R1 when all gates are satisfied;
* close completed issues;
* safely clean completed worktrees/branches.

Agents may not:

* auto-merge R2;
* execute R3 actions;
* force-push protected branches;
* rewrite public history;
* discard unknown work;
* bypass branch protection;
* bypass required checks;
* manufacture review/CI evidence.

---

## Common verification commands

* `pnpm validate:catalog`
* `pnpm test:unit`
* `pnpm check`
* `pnpm build`
* `pnpm test:e2e`
* `pnpm db:lint`
* `pnpm db:test`
* `pnpm test:db:contracts`
* `pnpm check:release`

Run only the checks relevant to the risk/change surface during iteration, then the required completion matrix from `docs/agents/AUTONOMY.md`.

For a scoped gate or operational procedure, use the gate's exact required verification rather than substituting a generic test suite.

---

## Verification rules

### R0

Run:

* narrow document/configuration/diff validation appropriate to the change.

### R1

Run:

* affected tests;
* `pnpm check`;
* `pnpm build` when runtime behavior changed;
* relevant browser/E2E verification for user journeys;
* independent review;
* CI.

### R2

Run:

* all relevant R1 checks;
* full relevant application/database/security/browser verification for the affected surface;
* specialist review;
* migration-from-scratch where applicable;
* hostile-client/security-boundary tests where applicable;
* owner approval before merge.

### R3

Before owner action:

* prepare dry-run where possible;
* verify target;
* verify pre-state;
* prepare backup/recovery path;
* prepare rollback;
* identify exact mutation.

After owner action:

* independently verify resulting state;
* capture required evidence.

Never claim a check passed unless it was run freshly and its output was inspected.

Never claim:

* DONE;
* PASS;
* FIXED;
* GREEN;
* DEPLOYED;
* MERGED;
* ROLLED BACK;
* MIGRATED;

unless the required evidence actually proves that claim.

Evidence before assertion.

---

## Hosted/provider verification

For Supabase, Cloudflare, GitHub release state, email providers, Turnstile or other hosted systems:

1. Establish the exact target project/environment.
2. Establish the exact expected pre-state.
3. Preserve relevant provenance evidence.
4. Perform only the authorized mutation.
5. Verify resulting state independently.
6. Capture evidence sufficient to distinguish PASS from assumption.
7. Roll back when the governing procedure requires rollback.

Do not infer deployed state merely from:

* local source;
* successful build;
* successful push;
* successful deployment command;
* successful provider mutation request.

Verify the actual hosted state.

A successful deployment command is not proof that intended traffic serves the intended version.

A successful local test is not proof of hosted convergence.

---

## Security-sensitive engineering

Treat the database as an authorization boundary, not merely storage.

Preserve RLS and database-authoritative invariants.

Never edit existing applied migrations.

Use forward-only migrations.

Never replace database authorization with UI-only or application-only checks.

Treat browser state as untrusted.

Authenticate and authorize server-side.

Treat uploads and request bodies as hostile input.

Maintain bounded body/file handling.

Do not trust MIME type or `Content-Length` alone.

Preserve image sanitization/re-encoding and evidence-lifecycle rules where applicable.

Do not expose private/quarantined evidence through public paths.

Staff/admin authorization must preserve the project's established role and MFA/AAL requirements.

Never weaken:

* authentication;
* MFA;
* suspension;
* membership;
* evidence;
* RLS;
* moderator boundaries;

merely to unblock tests or hosted setup.

Service-role access is privileged trusted-system access and must remain tightly scoped.

---

## Execution and repair behavior

Follow `docs/agents/EXECUTION-LOOP.md`.

Default repair budgets:

* focused implementation/test failure: 3 materially different repair attempts;
* CI failure: 3 materially different root-cause repair attempts;
* serious review finding: 3 review/fix cycles;
* hosted/staging ambiguity: 2 repair attempts before escalation.

Do not repeat the same failed edit and count it as a new attempt.

Each repair attempt should be based on new evidence or a materially different hypothesis.

When the budget is exhausted, trigger H6 with:

* exact failure;
* evidence gathered;
* hypotheses eliminated;
* remaining uncertainty;
* recommended next action.

Do not hide exhaustion by continuing indefinitely.

---

## Issue tracker

GitHub Issues are the canonical executable engineering queue.

See `docs/agents/issue-tracker.md`.

Normal work should move through:

`issue selection → implementation → PR → verification → merge → issue close`

GitHub Issue + PR + CI are the normal engineering record.

Do not create duplicate issues for work already represented by an active canonical issue unless the existing issue explicitly needs decomposition.

Reconcile stale issue state against merged repository state before selecting work.

---

## Documentation behavior

* `docs/MASTER-PLAN.md` remains the product/phase authority and must not become an engineering work journal.
* `docs/PROJECT-STATUS.md` remains a concise living snapshot.
* Update `PROJECT-STATUS.md` automatically only when actual current state, blockers or next steps materially change.
* Do not copy fast-changing phase state into this `AGENTS.md`.
* If an owner-only business/legal/product decision is surfaced, record it in the appropriate open-questions area without guessing the answer.
* Do not ask after every ordinary task whether to create a task-result Markdown file.
* Create dedicated tracked result artifacts only for significant audits, incidents, phase completion, release/deployment evidence, hosted acceptance, backup/restore rehearsal or major architecture decisions.
* Agent documentation should describe durable process, not transient implementation status.
* When editing agent-facing documentation, Matt `writing-for-agents` may be used when installed.

---

## Component/refactor policy

Do not create broad refactors merely because a file is large.

Extract components/modules opportunistically only when the extraction directly makes the current requested change:

* safer;
* clearer;
* easier to test;
* easier to review;
* easier to reason about.

Keep each diff small and reviewable.

Do not use a scoped gate, security repair or release task as an excuse for unrelated architectural cleanup.

---

## Subagents

When subagents are used:

* give each subagent a bounded objective;
* provide the governing scope;
* provide relevant security/product invariants;
* separate exploration, implementation and review when useful;
* parallelize independent investigation;
* avoid parallel conflicting edits to the same surface;
* do not allow subagents to broaden scope;
* verify surprising findings against the actual repository;
* treat subagent conclusions as evidence to inspect, not automatic truth.

The parent agent remains responsible for the final result and completion claim.

Subagents should follow the same skill-routing hierarchy:

1. repository authority;
2. Superpowers process where applicable;
3. Matt engineering-depth skills where useful;
4. ECC specialist skills where useful.

---

## Completion standard

A task is complete only when:

* the requested behavior is implemented, or the exact blocker is identified;
* the change remains within authorized scope;
* relevant tests/checks have run;
* fresh output has been inspected;
* required review has occurred;
* security-sensitive specialist review has occurred where applicable;
* git/provider state is understood;
* documentation required by the governing procedure is updated;
* the final report distinguishes proven facts from inference;
* remaining uncertainty or blockers are explicit.

Before claiming completion:

1. inspect the final diff;
2. run the required verification;
3. inspect the output;
4. verify relevant git/provider state;
5. verify no unexpected scope expansion;
6. state exactly what was proven;
7. state anything that remains unproven.

Never convert:

* "probably";
* "should";
* "looks like";
* "command exited successfully";

into PASS without evidence.

---

## Agent documentation

* `docs/agents/AUTONOMY.md` — permissions, risk levels, verification and merge rules.
* `docs/agents/EXECUTION-LOOP.md` — autonomous state machine and repair budgets.
* `docs/agents/SKILL-ROUTER.md` — deterministic routing between Superpowers, Matt Pocock and ECC skills.
* `docs/agents/HUMAN-GATES.md` — the only normal reasons to stop for the owner.
* `docs/agents/issue-tracker.md` — GitHub queue vocabulary and selection rules.
* `docs/agents/domain.md` — authoritative domain-document map.

`docs/agents/SKILL-ROUTER.md` should contain the detailed skill-selection matrix.

This root file defines the authority model; the router defines the operational mapping.

---

## Final operating principle

Operate autonomously by default.

Be conservative about scope.

Be aggressive about verification.

Use one process owner.

Use specialists only where they add distinct expertise.

Do not ask the owner to make ordinary engineering decisions that the repository already authorizes the agent to make.

Do stop for real Human Gates.

Do not weaken safety boundaries to increase autonomy.

Do not confuse activity with evidence.

**Repository truth > workflow preference.
Evidence > assertion.
One process > competing processes.
Small reversible changes > broad speculative changes.**
