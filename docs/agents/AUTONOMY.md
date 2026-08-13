# Autonomous Engineering Policy

## Purpose

This file defines what agents may do without owner interruption, how engineering risk is classified, what evidence is required before merge, and which actions can never be automatic.

The operating principle is:

> **Autonomous by default; human approval at high-risk boundaries.**

The owner is responsible for product, legal, business and protected production decisions.

Agents are responsible for engineering execution.

This policy applies regardless of which process or specialist skill is active.

The unified skill stack is:

* **Superpowers** — process authority.
* **Matt Pocock skills** — engineering-depth specialists.
* **ECC/repository/platform skills** — narrow technical specialists.

Skills may improve HOW work is performed.

They may not change:

* the issue's risk class;
* Human Gate requirements;
* merge permissions;
* production permissions;
* repository scope;
* owner decisions;
* required evidence.

Repository authority always wins.

---

## Core autonomy rules

Agents should complete all safe engineering work before interrupting the owner.

Ordinary reversible engineering decisions do not require owner confirmation when:

* repository architecture already determines the answer;
* an approved specification determines the answer;
* issue acceptance criteria determine the answer;
* existing project patterns provide a clear safe implementation;
* the choice can be independently reviewed and reversed.

A generic skill's request for human approval does not create a new Human Gate.

The only normal Human Gates are those defined by:

* root `AGENTS.md`;
* `docs/agents/HUMAN-GATES.md`;
* this risk policy;
* an explicit approved gate/specification;
* an explicit current owner instruction.

No skill may downgrade a Human Gate.

No skill may classify protected work as routine merely to continue autonomously.

---

## Risk classification

Every executable issue receives exactly one current risk class before implementation.

If scope changes, reclassify immediately.

Risk is based on the **highest-risk material behavior changed**, not on:

* number of changed files;
* amount of code;
* apparent simplicity;
* whether tests already exist;
* whether the change is easy to implement.

A one-line authorization change may be R2.

A large documentation cleanup may remain R0.

---

## R0 — trivial / documentation

Use when failure cannot materially change:

* runtime behavior;
* authorization;
* privacy;
* security boundaries;
* provider state;
* production state;
* product/legal policy.

Typical examples:

* spelling/copy correction that does not change policy;
* current engineering-document reconciliation;
* formatting-only work;
* comments/JSDoc/test-description cleanup;
* mechanically updating current technical references without changing behavior.

### Autonomy

Full.

### Merge

Automatic after appropriate narrow validation.

Independent review is optional when the diff is mechanically obvious and cannot materially affect behavior or policy.

### Skills

Use specialist skills only when they add clear value.

Do not invoke a full feature-development workflow for a mechanical documentation edit unless the change alters agent behavior, architecture or policy.

Agent-policy documents such as:

* `AGENTS.md`;
* `docs/agents/*`;
* skills;

require extra care because small text changes can materially alter agent behavior.

Such documentation may still be R0/R1 depending on impact.

---

## R1 — normal engineering

Use for ordinary application work inside established security and product boundaries.

Typical examples:

* component/unit tests;
* smoke coverage;
* ordinary UI/accessibility fixes;
* non-security bug fixes;
* safe refactoring covered by tests;
* performance improvements without auth/privacy effects;
* small server behavior that uses existing authorization rules unchanged;
* deterministic code cleanup that preserves security and product semantics.

### Autonomy

Full.

Agents may:

* design;
* implement;
* test;
* review;
* repair CI;
* push;
* open/update PRs;
* merge;

when all R1 completion requirements are satisfied.

### Merge

Automatic only when:

* required verification passed;
* independent review passed;
* triggered specialist reviews passed;
* CI passed;
* no Human Gate exists.

---

## R2 — high-risk engineering

Classify as R2 when the issue touches or materially changes any of these surfaces:

* authentication;
* sessions;
* login;
* registration;
* password recovery;
* MFA;
* assurance/AAL behavior;
* onboarding activation;
* membership authorization;
* admission state;
* Supabase RLS;
* authorization predicates;
* `SECURITY DEFINER` functions;
* service-role or other privileged database usage;
* staff/admin/moderator permissions;
* privacy boundaries;
* cross-user visibility;
* private Storage;
* evidence access;
* listing/report evidence upload security;
* account deletion;
* anonymization;
* data export;
* retention;
* blocking;
* reporting;
* moderation;
* immutable evidence behavior;
* security-sensitive secrets/runtime configuration;
* migrations affecting existing data, ownership, authorization, privacy or invariants;
* deployment/rollback compatibility with material availability consequences;
* email/webhook behavior where duplication or disclosure has material consequences;
* any path where a defect could expose one user's confidential data to another;
* any issue explicitly marked high risk by an approved specification or reviewer.

### Autonomy

Agents autonomously complete all safe engineering work before stopping.

This includes:

* investigation;
* technical design;
* implementation;
* tests;
* local migrations;
* specialist review;
* independent review;
* PR creation;
* CI repair;
* review-feedback repair;
* staging verification when separately authorized by repository/gate policy;
* preparation of merge evidence.

### Merge

**Prohibited until Human Gate H3 is approved.**

A completely green R2 PR waits for owner approval.

Skills cannot auto-approve H3.

Subagents cannot auto-approve H3.

A reviewer cannot auto-approve H3 unless that reviewer is the project owner explicitly providing the required approval.

---

## R3 — owner action / production or policy gate

R3 is a protected-action boundary rather than a normal engineering merge class.

Typical examples:

* applying a migration to production;
* destructive production database operations;
* rotating or revealing production secrets;
* material production DNS/provider changes;
* payment/monetization activation;
* legal/privacy/retention policy decisions;
* core moderation/business-policy decisions not already documented;
* bulk customer communications;
* deleting production data;
* deleting production Storage;
* destroying infrastructure;
* irreversible production operations;
* protected provider configuration where owner action is required.

### Autonomy

Agents prepare everything that is safe:

* research;
* code;
* deterministic tests;
* dry-runs;
* synthetic/non-production verification;
* backups;
* rollback plans;
* runbooks;
* exact click-by-click owner instructions;
* expected post-state;
* verification steps.

Matt/repository `wizard` may assist with human-executable provider instructions.

### Execution

Owner action or explicit owner approval is required for the protected action.

An R2 code change may contain an R3 deployment/application step.

Example:

* migration code = R2;
* applying that migration to production = R3.

Merging R2 code never implicitly authorizes the R3 action.

---

# Automatically allowed

Provided repository rules and risk routing are followed, agents may without asking:

* read/search repository and documentation;
* inspect Git history/diffs;
* inspect issues/PRs;
* inspect provider state through read-only capabilities;
* use official technical documentation;
* use available specialist integrations;
* invoke applicable Superpowers skills;
* invoke applicable Matt skills;
* invoke applicable ECC/repository specialist skills;
* create/update/label GitHub Issues;
* create isolated branches/worktrees;
* modify non-production code/configuration;
* make reversible technical design decisions;
* create tests and test fixtures;
* create new forward-only migrations locally;
* run local database reset/lint/pgTAP;
* run unit/component/contract/E2E/static/build/security checks;
* create scoped commits;
* push feature branches;
* open/update PRs;
* inspect and repair CI;
* address technically valid review comments;
* reject technically invalid review comments with evidence;
* update current engineering documentation after verified behavior changes;
* close merged issues;
* clean completed worktrees/branches safely;
* auto-merge R0/R1 when every required gate is satisfied.

Ordinary use of these permissions does not require repeated owner confirmation.

---

# Automatically allowed only outside production

When repository/gate rules permit it, agents may outside production:

* apply development migrations;
* apply staging migrations;
* seed/reset development databases;
* create synthetic accounts/data;
* run destructive fixtures against explicitly non-production databases;
* deploy staging/preview builds;
* perform staging browser acceptance checks;
* perform hosted security acceptance;
* create temporary staging resources needed by an approved test;
* test rollback behavior against staging/preview systems.

Before any destructive or materially mutating non-production operation:

1. identify the provider;
2. identify the exact project/account;
3. identify the exact environment;
4. prove the target is non-production;
5. understand the expected pre-state;
6. understand the expected post-state;
7. understand rollback/recovery when relevant.

If target identity is ambiguous:

> **Fail closed.**

Do not infer non-production identity from:

* a hostname alone;
* local `.env` assumptions;
* previous conversation memory;
* a project name that merely looks like "staging";
* a script default.

Use authoritative target evidence where practical.

A governing gate may further restrict these standing permissions.

For example, if an approved procedure authorizes **A9 only**, this policy does not authorize nearby A8/A10/provider work merely because it would normally be allowed in staging.

---

# Never automatic

Agents must never automatically:

* merge R2 without H3 approval;
* execute an R3 action without required owner involvement;
* edit an existing applied Supabase migration;
* weaken tests to obtain green CI;
* weaken security checks to obtain green CI;
* weaken RLS;
* weaken authentication;
* weaken MFA/AAL requirements;
* weaken privacy boundaries;
* use service role as a convenience shortcut;
* expose private user information in logs;
* expose secrets in prompts;
* expose secrets in issues;
* expose secrets in PRs;
* expose private evidence in reports;
* silently change a documented owner decision;
* enable payments/boosts/ads/monetization outside approved scope;
* force-push protected branches;
* rewrite protected/public history;
* discard unknown work;
* bypass required checks;
* bypass branch protection;
* fabricate review evidence;
* fabricate CI evidence;
* fabricate provider evidence;
* fabricate deployment evidence;
* call a hosted state PASS without sufficient hosted evidence.

No skill can override these prohibitions.

---

# Verification principles

Verification is evidence, not confidence.

Use:

> narrow iteration → broader completion verification → independent review → final evidence inspection.

Do not run the entire repository test matrix after every small edit unless required.

During iteration:

* run the narrowest meaningful test;
* inspect failure;
* repair based on evidence;
* repeat.

Before completion:

* run the matrix required by final risk class;
* run triggered specialist verification;
* inspect output freshly.

A command existing in history does not count as fresh verification.

A previous agent saying a check passed does not count as fresh verification unless the governing procedure explicitly accepts that evidence.

A successful command exit proves only what that command actually verifies.

Examples:

* `pnpm build` does not prove authorization correctness;
* local pgTAP does not prove hosted migration state;
* successful deploy command does not prove traffic convergence;
* successful upload does not prove read ACL correctness;
* green CI does not prove production health.

---

# Verification matrix

## R0 completion

Required:

* inspect final diff;
* run relevant formatting/link/schema/document checks when such tooling exists;
* confirm no policy/product meaning changed unintentionally.

For agent-policy documentation:

* inspect for contradictions with root `AGENTS.md`;
* inspect for duplicate authority;
* inspect for accidental new Human Gates;
* inspect for accidental autonomy expansion.

---

## R1 completion

Required unless the issue clearly makes a listed check irrelevant:

* focused tests for changed behavior;
* `pnpm check`;
* `pnpm build` when runtime/UI/server behavior changed;
* relevant component verification for component behavior;
* relevant Playwright/browser flow for user-facing journeys;
* independent code review;
* no unresolved Critical/Important findings;
* GitHub required checks green.

Database-touching R1 work additionally runs applicable:

* `pnpm db:lint`;
* `pnpm db:test`;
* `pnpm test:db:contracts`.

### R1 specialist routing

Use specialists where the trigger applies.

Examples:

* Matt `codebase-design` for meaningful module-boundary work;
* Matt `domain-modeling` for domain-state changes;
* ECC `e2e-testing` for complex browser journeys;
* ECC `backend-patterns` for backend implementation questions;
* ECC `documentation-lookup` for unstable external APIs.

Specialist use does not automatically raise risk.

The behavior changed determines risk.

---

## R2 completion

Required:

* all applicable R1 checks;
* full relevant unit/contract suite for the affected boundary;
* `pnpm check`;
* `pnpm build`;
* relevant E2E/browser lifecycle verification;
* `pnpm db:lint` and `pnpm db:test` for DB/RLS/function changes;
* `pnpm test:db:contracts` where relevant;
* migration-from-scratch/reset verification for migrations when local tooling supports it;
* hostile-client/security-boundary tests where applicable;
* relevant security specialist review;
* relevant platform specialist review;
* independent code review;
* GitHub CI green;
* no unresolved Critical/Important findings;
* H3 owner approval before merge.

### Security-sensitive R2

When security/privacy/auth boundaries materially change:

Preferred additional review:

* ECC `security-review`, when installed;
* strongest available Codex security specialist if applicable.

The security review should inspect adversarially rather than merely re-run the normal code-review checklist.

### Database/RLS R2

For:

* migrations;
* RLS;
* `SECURITY DEFINER`;
* Storage authorization;
* privileged database paths;

require Supabase/PostgreSQL-specific reasoning and deterministic DB evidence.

Do not infer database authorization from application behavior alone.

### Cloudflare/runtime R2

For:

* Worker runtime compatibility;
* deployment behavior;
* rollback;
* version convergence;
* request limits;
* secrets/bindings;

use platform-specific verification where available.

### Browser/security boundary R2

For flows such as:

* login;
* registration;
* onboarding;
* moderation;
* evidence;
* account lifecycle;
* admin;

perform actual lifecycle verification when the behavior is meaningfully exercised through the browser/runtime boundary.

A reviewer may require an additional targeted check when the change surface justifies it.

---

## R3 completion

Before the protected action:

1. identify exact provider/system;
2. identify exact account/project;
3. identify exact target environment;
4. verify current pre-state;
5. produce dry-run or preview when supported;
6. document backup/recovery state when data can be affected;
7. document rollback/reversal path;
8. list expected observable result;
9. identify post-action verification;
10. obtain owner approval/action.

After the action:

* run targeted health verification;
* run compatibility verification;
* verify actual provider state;
* confirm no unexpected production effect;
* record release/incident evidence when appropriate.

Do not mark the R3 action complete merely because the owner reports clicking a button.

When tooling permits, independently verify the resulting state.

---

# Specialist review policy

Specialist reviews are triggered by the changed surface.

They do not replace independent engineering review.

## Normal engineering review

Preferred:

* Superpowers `requesting-code-review`;
* Matt `code-review` when installed.

Review should distinguish:

* specification compliance;
* engineering quality;
* test quality;
* regression risk.

## Security specialist review

Preferred:

* ECC `security-review`.

Mandatory when required by R2 security trigger and available.

## Backend specialist

Preferred:

* ECC `backend-patterns`.

Use when server/data/service architecture warrants dedicated backend expertise.

## Browser/E2E specialist

Preferred:

* ECC `e2e-testing`.

Use for complicated Playwright/browser journey design.

## Domain/design specialist

Preferred:

* Matt `domain-modeling`;
* Matt `codebase-design`.

Use before implementation when domain or module boundaries need clarification.

Specialist review cannot downgrade issue risk.

Specialist PASS cannot substitute for required repository verification.

---

# Hosted/provider evidence

Hosted claims require hosted evidence.

When work concerns:

* Supabase hosted state;
* Cloudflare deployment;
* Turnstile;
* transactional email;
* GitHub settings;
* external providers;
* staging;
* production;

distinguish:

1. source state;
2. local state;
3. provider configuration;
4. deployed artifact/version;
5. active traffic/runtime state;
6. observable end-to-end behavior.

These are different claims.

Do not infer one solely from another.

Examples:

> Git source is correct ≠ deployment is correct.

> Deployment exists ≠ deployment serves traffic.

> Secret exists ≠ correct version uses that secret.

> Provider accepted configuration ≠ end-to-end behavior works.

> Local DB test passes ≠ hosted DB state matches.

Required evidence depends on the governing gate.

---

# Reclassification rules

Immediately raise risk when implementation reveals a higher-risk boundary.

Examples:

* R1 UI test requires changing RLS → split/create R2 work;
* R1 bug fix exposes an auth design defect → create/convert to R2;
* R1 refactor begins modifying private-data visibility → R2;
* R2 migration requires a production push → code remains R2, production application becomes R3;
* apparently simple provider configuration turns out to affect production → R3.

Risk may be lowered only when evidence proves the suspected high-risk surface is not actually being changed.

Do not lower classification merely because implementation became easier than expected.

Never hide R2/R3 work inside an R1 PR to preserve auto-merge eligibility.

If an issue contains separable R1 and R2 work, prefer splitting it when this makes review and merge safety clearer.

---

# Scope expansion

Autonomy is not permission to broaden scope.

When an agent discovers unrelated work:

* record it;
* create/update an issue if appropriate;
* continue the authorized task.

Do not fix unrelated findings inline unless:

* the change is necessary to safely complete the current task; or
* the owner/approved plan explicitly expands scope.

For gate-scoped work, follow the gate exactly.

Example:

> A9 authorization does not imply authorization for A8 cleanup, A10 preparation or unrelated provider configuration.

---

# Repair behavior

Use `docs/agents/EXECUTION-LOOP.md`.

Repair attempts must be materially different and evidence-driven.

Default budgets remain:

* focused implementation/test failure: 3 materially different repair attempts;
* CI failure: 3 materially different root-cause repair attempts;
* serious review finding: 3 review/fix cycles;
* hosted/staging ambiguity: 2 repair attempts before escalation.

Do not evade H6 by:

* renaming the same hypothesis;
* repeating the same failing edit;
* changing unrelated code;
* weakening tests;
* skipping evidence.

When repair budget is exhausted, complete all safe diagnostic work and trigger H6.

---

# Merge rules

## R0/R1 auto-merge

Auto-merge is allowed only if:

1. required local verification passed freshly;
2. independent review requirements are satisfied;
3. any triggered specialist review passed;
4. GitHub required checks are green;
5. the branch is mergeable/up to date under repository policy;
6. no `human-gate` condition exists;
7. no unresolved Critical/Important finding remains;
8. final diff remains within the classified risk scope;
9. no unexpected security/provider/production boundary was introduced.

If a final diff review discovers R2 behavior:

> reclassify before merge.

Do not auto-merge first and reclassify afterward.

---

## R2

A green R2 PR waits.

Present H3 using `HUMAN-GATES.md`.

H3 should summarize:

* what changed;
* why it is R2;
* relevant security boundary;
* verification run;
* specialist review result;
* independent review result;
* CI state;
* known residual risk;
* exact merge action requested.

Merge only after explicit owner approval.

Do not ask for H3 before the PR is otherwise ready.

---

# Production

Merging code never implicitly authorizes:

* production migration;
* production secret change;
* DNS change;
* destructive production action;
* production provider mutation;
* monetization activation;
* protected production rollout.

Code merge permission and production-action permission are separate decisions.

A production action follows R3/H4/H5 as applicable.

---

# Skill-system boundary

The unified Codex skill system must preserve this autonomy policy.

### Superpowers may

* determine engineering process;
* structure debugging;
* structure planning;
* enforce TDD;
* require review;
* require verification.

### Superpowers may not

* add unnecessary owner interruptions that conflict with standing autonomy;
* waive H3/H4/H5;
* downgrade R2/R3;
* broaden approved scope.

### Matt Pocock skills may

* deepen bug diagnosis;
* improve domain modeling;
* improve codebase design;
* perform detailed code review;
* prepare human instructions;
* improve agent-facing documentation.

### Matt Pocock skills may not

* replace repository risk policy;
* create a competing merge policy;
* waive Human Gates.

### ECC/repository specialists may

* provide security expertise;
* provide backend expertise;
* provide E2E expertise;
* provide eval expertise;
* look up current external documentation.

### ECC/repository specialists may not

* become a second process owner;
* replace required verification;
* waive repository evidence standards;
* alter merge permissions.

---

# Final autonomy principle

The desired agent is not an agent that asks permission constantly.

It is an agent that:

* understands scope;
* understands risk;
* makes reversible technical decisions;
* uses the correct process;
* invokes specialists only where useful;
* verifies aggressively;
* stops at real protected boundaries.

Therefore:

> **Autonomous engineering is the default.**

But:

> **Autonomy ends where owner authority, irreversible risk, production protection or high-risk merge approval begins.**

And:

> **No amount of agent confidence substitutes for required evidence.**
