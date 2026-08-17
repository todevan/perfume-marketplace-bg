# Perfume Marketplace — Master Plan

## Purpose

This document defines the durable product direction, major roadmap phases, owner-controlled business decisions and long-lived project constraints for `perfume-marketplace-bg`.

It is a project-level source of truth, but it is not the sole authority for every kind of repository decision.

Agents must use the repository's authority hierarchy rather than treating this file as a replacement for more specific instructions.

The effective relationship is:

```text
AGENTS.md and applicable repository instructions
        ↓
Authoritative project/domain documentation
        ↓
Current PROJECT-STATUS / launch-gate documentation
        ↓
Current GitHub issue / explicitly authorized scope
        ↓
Skill-assisted reasoning and execution
```

For agent behavior and execution policy, use the applicable documents under `docs/agents/`, especially:

- `docs/agents/AUTONOMY.md`
- `docs/agents/EXECUTION-LOOP.md`
- `docs/agents/HUMAN-GATES.md`
- `docs/agents/SKILL-ROUTER.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`

For architecture, use `docs/ARCHITECTURE.md`.

For the current implementation/release state, use `docs/PROJECT-STATUS.md` and the applicable launch/reconciliation documentation.

Do not infer current hosted state solely from this master plan.

---

## Owner

Owner: **Tedi**

The owner is the final authority for product, business, legal, privacy and protected production decisions that fall outside autonomous engineering authority.

The owner is not expected to approve ordinary implementation details that the repository's autonomy policy allows the agent to decide safely.

Use the Human Gates defined in `docs/agents/HUMAN-GATES.md` when owner involvement is actually required.

---

## Last durable review

Last updated: **2026-08-11**

This date describes the durable master-plan document.

It must not be used as evidence that implementation, hosted-provider state or release status was current on that date.

Use `docs/PROJECT-STATUS.md` and current gate evidence for operational status.

---

# 1. What this project is

A Bulgarian online marketplace for buying, selling and exchanging new, pre-owned and collectible perfumes.

Private sellers, collectors and verified merchants publish structured listings.

Buyers discover listings through a catalogue, search and typed filters.

Participants negotiate through internal messaging and structured offers.

Payment and delivery happen off-platform.

The platform:

- does not process marketplace payments;
- does not hold seller inventory;
- does not guarantee authenticity;
- provides marketplace structure, discovery, trust signals and moderation.

The current closed-beta transaction model intentionally keeps payment and delivery outside the platform.

Deferred monetisation or payment scaffolding does not authorize activation of payments, checkout, subscriptions, boosts, ads or other monetisation features.

The durable product concept is defined by this document together with:

- `docs/ARCHITECTURE.md`
- `docs/BUSINESS-MODEL.md`
- applicable product/UI specifications in `docs/`

Do not invent or require a missing `docs/CONCEPT.md`.
## Target architecture

The active architecture is the implementation described in:

`docs/ARCHITECTURE.md`

At a high level, the current stack is:

- SvelteKit;
- TypeScript;
- Cloudflare Workers;
- Supabase PostgreSQL;
- Supabase Auth;
- Supabase private Storage;
- Supabase Realtime;
- Playwright;
- Resend;
- Turnstile;
- Cloudflare Images.

Do not revive obsolete architecture merely because an older concept or audit mentions another stack.

Material architecture changes must follow the repository's normal issue, risk and Human Gate process.

---

## Current product stage

The project is in **pre-launch development** and is not yet production-ready.

Public email-and-password registration is part of the intended product architecture.

A particular staging/reconciliation step may temporarily require registration or another provider capability to be disabled or enabled.

Treat those temporary provider states as release/gate state, not as permanent product policy.

The exact current phase, gate, blockers, merged SHA and hosted state must come from:

- `docs/PROJECT-STATUS.md`;
- `docs/LAUNCH-GATES.md`;
- the applicable approved reconciliation/release plan;
- current GitHub Issues;
- verified repository/provider evidence.

Do not maintain a second volatile status summary in this file.

---

# 2. Roadmap authority

The broad phase plan below describes the intended order of the project.

It is not the autonomous engineering queue.

Executable work lives in GitHub Issues according to:

`docs/agents/issue-tracker.md`

Detailed gate work may also be governed by approved plans under:

`docs/superpowers/plans/`

Do not skip ahead or combine broad phases when doing so would violate:

- an active issue;
- dependency ordering;
- a named release/reconciliation gate;
- risk boundaries;
- Human Gates;
- explicit owner scope.

A named sub-gate such as:

```text
A9 only
```

is a hard execution boundary even when adjacent work belongs to the same broad roadmap phase.

Discovering an earlier prerequisite does not authorize performing it.

---

# 3. Broad phase plan

| Phase | Goal | Exit condition |
|---|---|---|
| 0 | Security containment | Exposed credential rotated, removed from files and relevant activity reviewed |
| 1 | Restore a green, buildable branch | Required local checks and PR CI pass |
| 2 | Security hardening and hosted integration tests | Security boundaries hold when bypassing the UI, not merely through normal app flows |
| 3 | Activate and reconcile required staging providers | Required real hosted actors can complete the intended staging lifecycle with verified evidence |
| 4 | Legal and privacy completion | No placeholder legal content; required export/deletion/privacy behavior implemented and verified |
| 5 | UX completion and regression protection | Dead controls are removed or implemented and critical product flows have appropriate regression coverage |
| 6 | Backup, monitoring and production deployment | Production can be deployed, monitored and restored predictably under the approved release process |
| 7 | Post-launch maintenance | Ongoing operational phase rather than a one-time exit condition |

Detailed task history and older audit findings may exist in dated audit documents.

Current executable scope must come from the active GitHub issue and current project/gate documentation rather than from old audit task lists.

---

# 4. Phase and gate discipline

Broad phases describe roadmap order.

Named gates and reconciliation steps describe narrower executable boundaries.

The agent must preserve both.

For example:

```text
Phase 3
  └─ Gate 3 staging reconciliation
       ├─ A7
       ├─ A8
       ├─ A9
       └─ later explicitly defined steps
```

Being authorized for a broad phase does not automatically authorize every mutation inside that phase.

Being authorized for `A9 only` does not authorize:

- changing an A8 prerequisite;
- beginning an A10 task;
- performing unrelated provider cleanup;
- changing production;
- expanding into nearby architectural work.

When a required prerequisite falls outside current authority:

1. preserve completed valid work;
2. identify the exact blocker;
3. record the dependency;
4. use the appropriate issue state or Human Gate;
5. do not silently cross the scope boundary.

---

# 5. Open product, business and policy questions

The questions below represent durable owner-controlled decisions that were unresolved when recorded.

They are not automatically active blockers for every engineering task.

Before treating one as unresolved, check:

- later entries in **Decisions Made**;
- `docs/PROJECT-STATUS.md`;
- applicable GitHub issues;
- later explicit owner decisions;
- applicable Human Gate receipts.

Questions:

- Final site name and domain.
- Legal operator/entity for the business.
- Public support email.
- Privacy contact.
- Appeals channel for moderation disputes.
- Should merchant verification remain manual or use a dedicated upload workflow?
- Expected initial beta size.
- Backup retention period and acceptable downtime.
- Are chat attachments needed for v1 or deferred?
- Is public search-engine indexing ever desired, and if so, when?
- What message policy should be enforced for edit deadlines, irreversible deletion behavior, immutable revision/snapshot scope and moderation retention/legal-hold duration?
- Should blocking be a unilateral inbound-contact prohibition, mutual conversation closure or local mute/hide, and what historical chat/deal access remains after blocking?
- Should expired offers remain visibly distinct from seller-declined and buyer-withdrawn offers in user and support history?
- Which transactional-email provider failures are terminal versus retryable, and which statuses count as transient?
- Should reports continue to accept up to four 10 MiB images in one Worker request, use a lower aggregate request limit, or move evidence to direct quarantine uploads to reduce peak isolate memory?

Do not add routine implementation questions here.

Ordinary engineering decisions should remain autonomous when permitted by repository policy.

Use H1–H6 when execution encounters a real owner decision boundary.

When the owner resolves a durable product/business/legal question, record the durable decision in the next section so future agents do not ask it again.

---

# 6. Decisions made

This section records durable owner decisions and their reasoning.

A later explicit owner decision may supersede an earlier one.

When that happens, preserve enough history to explain the change while making the currently authoritative decision unmistakable.

Recommended format:

```text
YYYY-MM-DD
Question:
...

Decision:
...

Reasoning:
...
```

---

## 2026-08-02 — Public registration and regular-user phone verification

**Question**

Should registration remain invite-only, and should regular users verify a phone before account activation or sensitive marketplace actions?

**Decision**

No.

The product uses standard public email-and-password signup and login.

Regular users do not require invitation-based registration, phone-number verification or SMS OTP verification for account activation or ordinary marketplace actions.

Email confirmation, existing password rules, secure-cookie sessions, legal onboarding/consents, suspension and moderation controls remain.

Staff/admin MFA remains separate and mandatory.

**Reasoning**

During the current development stage the owner wants the simplest regular-user authentication flow and does not want invites or phone verification to block testing or use.

Existing RLS policies and unrelated authorization/moderation behavior remain unchanged unless separately authorized.

---

## 2026-08-02 — Report attachment formats

**Question**

Are PDF report attachments required before launch, and how should report evidence be handled without a configured document scanner?

**Decision**

Report evidence is images-only for now.

Accepted images must be decoded and re-encoded through the trusted image processor before final storage.

PDFs and other document formats are rejected until a dedicated malware/PDF scanning solution exists.

Text-only reports remain available when image processing is unavailable.

**Reasoning**

This closes the active-content and malformed-file risk without silently storing unscanned documents or preventing users from submitting reports.

---

# 7. Standing project rules

These rules apply across phases unless a more specific repository instruction intentionally overrides them.

## 7.1 Read the applicable authority before acting

At the start of substantial repository work, establish the relevant context from:

- `AGENTS.md`;
- `docs/MASTER-PLAN.md`;
- `docs/PROJECT-STATUS.md`;
- `docs/ARCHITECTURE.md` when architecture is relevant;
- applicable `docs/agents/*` policy;
- the current GitHub issue;
- applicable launch/reconciliation plans.

Do not mechanically reread every document for every tiny command when the applicable context is already loaded and unchanged.

The goal is correct authority resolution, not ceremonial document reading.

---

## 7.2 Stay inside scope

Do not absorb unrelated work merely because it is nearby.

If work outside the issue, phase or named-gate scope is discovered:

- fix it inside the current issue only when repository repair-budget rules clearly allow it;
- otherwise create/update the appropriate issue or dependency;
- block when necessary;
- invoke the relevant Human Gate when autonomous authority ends.

Do not silently broaden scope.

---

## 7.3 Never commit real secrets

Real secrets must never be committed.

Examples and `.env.example` values must be:

- empty;
- explicitly fake;
- or safe provider-documented placeholders.

If a real credential is discovered in tracked material, follow repository security policy rather than merely deleting the visible occurrence and continuing.

---

## 7.4 Autonomous-by-default

Do not require owner approval for normal engineering work that repository policy already authorizes.

The agent should continue autonomously unless:

- a Human Gate applies;
- risk policy requires owner involvement;
- required authority is unavailable;
- a protected provider/production boundary is reached;
- current scope cannot safely resolve the blocker.

Do not introduce blanket approval checkpoints such as:

```text
show a plan
wait for owner approval
then execute
```

unless the applicable Human Gate or explicit task instructions require that pause.

---

## 7.5 Verify surprising findings

If a subagent, skill, tool, static analysis result or external integration reports something surprising, verify it against authoritative repository/provider evidence before treating it as fact.

Do not promote an unverified suspicion into:

- a blocker;
- a security finding;
- a project-status update;
- a Human Gate;
- a durable architecture conclusion.

This repository has previously encountered false positives, so independent verification remains mandatory where findings materially affect decisions.

---

## 7.6 Do not guess product or policy decisions

When multiple technically valid choices produce materially different user, business, privacy, legal or moderation behavior, use the appropriate Human Gate.

Do not let an installed skill silently decide owner policy.

After the owner makes a durable decision:

- record it in the appropriate authoritative document;
- update affected issue/acceptance criteria when necessary;
- avoid asking the same resolved question again.

---

## 7.7 Preserve evidence durably

Important outcomes must not exist only in chat/session history.

Depending on the work, durable evidence may belong in:

- GitHub Issues;
- pull requests;
- test output/receipts;
- `docs/PROJECT-STATUS.md`;
- approved plans;
- release/gate evidence;
- architecture or decision documentation.

Do not create a new documentation file when an existing authoritative location already owns the information.

---

## 7.8 Current state must be evidence-based

Do not claim a phase, gate, migration, provider activation or deployment is complete merely because implementation exists.

Completion requires the evidence defined by the relevant issue/gate.

Examples may include:

- tests;
- CI;
- code review;
- repository verification;
- database evidence;
- hosted staging evidence;
- provider evidence;
- exact SHA/deployment convergence;
- Human Gate approval when required.

Installed skill agreement is not completion evidence.

---

# 8. Unified Codex skill architecture

This repository uses one unified skill-routing model.

The detailed routing authority is:

`docs/agents/SKILL-ROUTER.md`

The high-level model is:

```text
PROCESS
→ Superpowers

DEEP ENGINEERING
→ Matt Pocock skills

SPECIALIST EXPERTISE
→ ECC / platform-specific skills
```

Repository documentation and `AGENTS.md` remain above all three.

---

## Superpowers

Superpowers is the primary process authority.

Use it where applicable for:

- brainstorming;
- planning;
- systematic debugging;
- TDD;
- implementation/execution;
- review workflow;
- verification before completion.

There should normally be one primary process loop.

---

## Matt Pocock skills

Matt Pocock skills provide additional engineering depth when useful.

Typical roles include:

- `diagnosing-bugs`;
- `domain-modeling`;
- `codebase-design`;
- `code-review`;
- `wizard`;
- `writing-for-agents`.

They deepen analysis but do not replace Superpowers process ownership.

---

## ECC and platform specialists

ECC or platform-specific skills provide specialist expertise where useful, including:

- security;
- backend;
- E2E / Playwright;
- evals;
- documentation lookup;
- Supabase;
- Cloudflare;
- GitHub integrations.

They contribute specialist constraints, findings and verification.

They do not establish a second execution lifecycle.

---

## No competing workflow loops

Do not run multiple competing:

- planners;
- debugging methodologies;
- TDD loops;
- execution frameworks;
- completion loops.

Typical bug routing:

```text
Superpowers systematic-debugging
→ Matt diagnosing-bugs if useful
→ Superpowers TDD / implementation
→ review
→ verification
```

Typical feature routing:

```text
Superpowers brainstorming / writing-plans
→ Matt domain-modeling / codebase-design if useful
→ Superpowers TDD / execution
→ review
→ verification
```

Typical security routing:

```text
Superpowers process
→ Matt design/domain reasoning if useful
→ ECC security specialist
→ independent review
→ verification
→ H3 before merge when R2
```

These are routing patterns, not mandatory ceremonies.

Use only the skills that materially improve the task.

---

# 9. GitHub Issues are the executable queue

The roadmap in this document does not replace the issue tracker.

Canonical executable work lives in:

`https://github.com/todevan/perfume-marketplace-bg/issues`

The queue and label contract are defined in:

`docs/agents/issue-tracker.md`

Plans, audits and specialist findings should become or update GitHub Issues when they represent durable executable work.

Do not create parallel autonomous queues in:

- plan documents;
- skill outputs;
- PR comments;
- local TODO files;
- session memory.

Pull requests are implementation/review surfaces rather than the default triage queue.

---

# 10. Risk and Human Gates

The repository uses:

- R0;
- R1;
- R2;
- R3;

and Human Gates:

- H1–H6.

The authoritative definitions live under `docs/agents/`.

At a high level:

```text
R0 / R1
→ autonomous execution and merge when all required gates pass

R2
→ autonomous implementation where permitted
→ required review/verification
→ H3 before merge

R3
→ protected owner/production/policy boundary
→ owner involvement required
```

Do not reinterpret these categories inside individual plans or skills.

Skill confidence does not lower risk.

Additional specialist review does not substitute for a required Human Gate.

---

# 11. Status and audit documents

Use documentation according to its purpose.

## `docs/MASTER-PLAN.md`

Durable:

- product direction;
- broad roadmap;
- standing project rules;
- owner decisions.

## `docs/PROJECT-STATUS.md`

Living operational state:

- current phase/gate;
- current blockers;
- important merged/released state;
- what should happen next.

## `docs/ARCHITECTURE.md`

Durable intended:

- runtime shape;
- application boundaries;
- security architecture;
- major domain/system invariants.

## `docs/LAUNCH-GATES.md`

Release/readiness authority:

- required launch boundaries;
- release acceptance;
- staging/production progression.

## Dated audit documents

Historical evidence and findings.

A dated audit is not automatically the current executable backlog.

If an audit finding remains valid and actionable, track it through the canonical GitHub issue queue.

## `docs/superpowers/plans/`

Approved detailed execution/reconciliation plans.

These may define strict sub-gate sequencing and acceptance evidence.

A plan does not supersede higher-authority repository instructions unless explicitly stated.

---

# 12. Session start behavior

A new Codex session should recover authoritative context before substantial execution.

A suitable conceptual startup sequence is:

```text
Read AGENTS.md.
Read the applicable agent-policy docs.
Read MASTER-PLAN.md for durable project direction.
Read PROJECT-STATUS.md for current state.
Read the active GitHub issue and applicable gate/plan.
Resolve contradictions before mutating.
Then continue autonomously until a real Human Gate is reached.
```

Do not use an old hard-coded startup prompt referring to Hermes.

Do not stop merely to tell the owner which phase is active when the requested task is already clear and autonomous work can continue.

Ask only when repository authority or a Human Gate genuinely requires owner input.

---

# 13. Documentation maintenance

Update this file only for durable changes such as:

- product direction;
- broad roadmap changes;
- durable owner decisions;
- standing project constraints;
- authority-model changes.

Do not update this file for every:

- commit;
- PR;
- deployment;
- temporary blocker;
- gate receipt;
- provider state change.

Those belong in the appropriate current-status, issue, PR or gate artifact.

When a durable decision supersedes earlier text, update the authoritative section rather than leaving contradictory rules scattered across the repository.

---

# 14. File index

Core reference documents include:

- `AGENTS.md` — repository-level agent authority and instructions.
- `docs/CONCEPT.md` — original business concept.
- `docs/MASTER-PLAN.md` — durable product direction, roadmap and owner decisions.
- `docs/PROJECT-STATUS.md` — living implementation/release state.
- `docs/ARCHITECTURE.md` — authoritative intended application architecture.
- `docs/LAUNCH-GATES.md` — release and launch-gate requirements.
- `docs/BUSINESS-MODEL.md` — business-model authority.
- `docs/AUDIT-2026-08-02.md` — historical full audit.
- `docs/agents/AUTONOMY.md` — autonomy and risk policy.
- `docs/agents/EXECUTION-LOOP.md` — execution lifecycle.
- `docs/agents/HUMAN-GATES.md` — H1–H6 owner boundaries.
- `docs/agents/SKILL-ROUTER.md` — unified Superpowers / Matt / ECC routing.
- `docs/agents/issue-tracker.md` — canonical GitHub queue policy.
- `docs/agents/domain.md` — domain-documentation authority.

Add reference documents here only when they become durable project authorities.

Do not turn the index into a list of every temporary plan, receipt or implementation artifact.

---

# Core invariant

```text
MASTER-PLAN defines durable project direction.
ARCHITECTURE defines intended system structure.
PROJECT-STATUS defines current operational state.
GitHub Issues define executable work.
Superpowers defines the primary engineering process.
Matt Pocock skills deepen engineering reasoning.
ECC/platform skills provide specialist expertise.
Human Gates define where autonomy stops.
Repository-defined evidence determines when work is complete.
```

No installed skill system may create a competing source of truth, queue or execution lifecycle.