# Project Status

## Purpose

This document is the repository's living operational status snapshot.

It answers:

- where the project is now;
- what was most recently completed;
- what is currently active;
- what is blocked;
- what the next authorized work is;
- which important boundaries must not be crossed.

It is not:

- the durable product roadmap;
- the architecture specification;
- the full audit history;
- the autonomous issue queue;
- a substitute for gate-specific evidence.

For those authorities, use:

- `docs/MASTER-PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/LAUNCH-GATES.md`
- applicable plans under `docs/superpowers/plans/`
- GitHub Issues
- applicable files under `docs/agents/`

Update this file when operational state materially changes.

Do not turn it into a chronological log of every command, test or agent session.

---

## Last updated

2026-08-17

---

# Current verdict

**Local engineering baseline: healthy.**

**Gate 3 staging reconciliation: active.**

**A7: complete.**

**A8: complete.**

**A9: active and not yet closed.**

**Production readiness: not yet achieved.**

Current execution is focused on completing the authenticated hosted-actor evidence required by A9 without crossing into later gate work or unrelated provider/production mutations.

Production remains outside the current authorized execution scope.

---

# Current phase and gate

Broad roadmap phase:

```text
Phase 3 — Activate and reconcile required staging providers
```

Current detailed work:

```text
Gate 3 staging reconciliation
```

Recent sequence:

```text
A7 — completed
A8 — completed
A9 — active
```

Named-gate scope remains authoritative.

If the current task says:

```text
A9 only
```

that does not authorize:

- earlier prerequisite mutations outside A9;
- later gate work;
- unrelated provider cleanup;
- production changes;
- architecture expansion;
- opportunistic remediation outside the applicable repair budget.

---

# Current merged baseline

The latest confirmed merged `main` baseline is:

```text
260ef616531457798658f9eacb9f7d4731460f65
```

It includes the A8 closure from:

```text
PR #11
```

and the merged A9 source work from:

```text
PR #12 — hosted A9 provisioning runner and operator foundation
PR #19 — A9 timestamp provenance correction
```

The prior A7 release was merged through:

```text
PR #10
```

Do not assume a later local or isolated-worktree commit is part of `main` unless Git/GitHub evidence proves it.

Exact SHA and tree convergence remain required wherever a gate explicitly depends on them.

---

# Recently completed

## A7

A7 was completed on staging and durably merged.

Verified outcomes included:

- exact source/deployment convergence;
- canonical staging smoke passing;
- native Turnstile evidence for login and registration paths;
- safe rollback behavior;
- staging Worker deployment verification.

The authenticated `report_submit` path was intentionally deferred to the later authenticated-actor gate rather than being forced into A7 scope.

A7 evidence must not be rerun or rewritten merely because later gates are active unless the current gate explicitly requires it.

---

## A8

A8 was completed operationally on staging and durably merged into `main`.

Its closure resolved the A8-specific staging reconciliation boundary and produced the A8 closure baseline:

```text
8592c1524842b829b76a83df89a4b9b2cca47e5f
```

A8 is closed.

Do not reopen A8 implementation while working on A9 unless new verified evidence proves A8 itself is invalid.

A dependency discovered during A9 that belongs to A8 or an earlier provider step does not automatically authorize mutating that earlier scope.

---

# A9 current state

A9 is the active Gate 3 boundary.

The objective is to obtain the required authenticated hosted evidence using controlled synthetic actors and target-locked operations.

An earlier A9 preflight identified two distinct blockers at that time:

1. hosted signup/provider state had to match the prerequisite sequence before A9 actor creation could proceed;
2. merged source did not yet contain all target-locked operator capabilities required for complete A9 actor preparation and attestation.

The missing A9 operator foundation was subsequently implemented, locally verified, and durably merged through PR #12. Its timestamp-provenance handling was subsequently corrected and durably merged through PR #19.

The A9 foundation result was:

```text
A9FoundationResult=PASS
```

The foundation work was based on:

```text
8592c1524842b829b76a83df89a4b9b2cca47e5f
```

and was intentionally limited to the A9 operator/evidence surface.

The core foundation change set included:

```text
scripts/hosted-report-evidence-operator.mjs
tests/scripts/hosted-report-evidence-operator.test.ts
tests/e2e/hosted-report-evidence.spec.ts
```

The foundation added or prepared target-locked capabilities needed for A9, including authenticated hosted actor/operator support.

This merged source state does **not** by itself mean A9 is complete or that the intended code is deployed on staging.

A9 remains open until the required hosted execution, evidence, verification and durable repository closure have all passed.

Repository merge evidence and hosted deployment/execution evidence remain separate claims and require separate proof.

---

# Current A9 boundary

Before performing hosted mutation, verify the exact prerequisites required by the authoritative A9 plan.

Do not infer provider state from an earlier session.

In particular, verify rather than assume:

- the intended hosted Auth signup state;
- the exact staging Supabase target;
- required A9 credentials/secrets;
- required actor provenance;
- target-lock protections;
- current merged source;
- whether the hosted target is running the intended merged A9 source before relying on it for hosted execution.

If a prerequisite belongs to a prior gate or requires an owner/provider action outside current autonomous authority:

- stop at that exact boundary;
- preserve completed valid work;
- record the blocker;
- use the applicable Human Gate or dependency path;
- do not silently broaden A9.

---

# A9 completion criteria

A9 must not be marked complete merely because:

- local tests pass;
- actor helper code exists;
- a synthetic user can log in;
- an operator script runs;
- a specialist reports success.

Closure requires the evidence defined by the authoritative Gate 3 reconciliation plan.

At minimum, the A9 closure must distinguish:

```text
local implementation evidence
≠
merged repository evidence
≠
hosted staging evidence
≠
complete gate closure
```

Where the plan requires authenticated hosted actors, AAL2 moderator behavior, report evidence, provenance or target-locked provider operations, those conditions must be proven directly.

---

# Security and architecture invariants still in force

The following remain non-negotiable while staging work continues:

- authentication identity is server-validated;
- active membership remains required for marketplace access;
- staff/moderator privileged behavior remains role-bound and AAL2-protected;
- RLS remains an authoritative data-access boundary;
- report evidence remains private and report/case scoped;
- moderation access remains target-specific, report-bound and audited;
- real secrets must never be committed;
- staging and production credentials/data remain separate;
- provider mutations must target the explicitly authorized project/environment;
- payments and monetisation remain disabled;
- deferred features must not be activated incidentally.

A hosted test does not justify weakening these invariants for convenience.

---

# Production boundary

Production is not the current execution target.

Do not perform production mutations as part of Gate 3 staging reconciliation unless an explicitly authorized later release step requires them.

Protected actions include, as applicable:

- production deployments;
- production database mutations;
- production Auth configuration;
- production secrets;
- production DNS/domain changes;
- monetisation activation;
- destructive provider actions.

Use the repository's R3/Human Gate rules when execution eventually reaches those boundaries.

---

# Current blockers

The active blockers should remain limited to blockers that affect current executable work.

For A9, the relevant unresolved boundary is:

1. verify that all prerequisite hosted/provider state required by the authoritative A9 sequence is satisfied;
2. prove the hosted target is running the intended merged A9 source before hosted execution depends on it;
3. execute and verify the required authenticated hosted A9 evidence;
4. durably close A9 only after all required repository and hosted evidence passes.

Do not carry old Phase 2 findings forward as "current blockers" merely because they appear in historical audits.

Independent unresolved work belongs in GitHub Issues with its own priority, risk and dependencies.

---

# Deferred and later work

The following categories remain outside the current A9-only boundary unless explicitly required as dependencies:

- later Gate 3 steps;
- legal/privacy completion;
- final message/blocking product semantics;
- UX completion;
- production backup rehearsal;
- production monitoring;
- production deployment;
- payments;
- delivery integration;
- chat attachments;
- boosts;
- subscriptions;
- ads;
- other monetisation.

Their existence must not expand the active issue automatically.

---

# Historical baseline

The full initial repository audit remains available at:

`docs/AUDIT-2026-08-02.md`

That document is historical evidence.

Some findings from it have since been:

- fixed;
- superseded;
- converted into later remediation/gate work;
- changed by explicit owner decisions.

Do not use an August 2 finding as current truth without reconciling it against newer repository state.

In particular, old invite-only or phone-verification assumptions are superseded by the durable owner decision recorded in `docs/MASTER-PLAN.md`.

---

# Operational evidence policy

Current status must be based on evidence appropriate to the claim.

Examples:

```text
Code exists
→ inspect repository state

Merged
→ verify Git/GitHub state

Deployed
→ verify provider deployment state

Database mutation applied
→ verify target database/provider state

Hosted flow passes
→ run the required hosted evidence

Gate complete
→ satisfy the gate's complete acceptance contract
```

Do not infer one level from another.

A clean local test suite does not prove hosted state.

A successful hosted operation does not prove the corresponding source is merged.

A merged PR does not prove the intended deployment is active.

---

# Queue and execution

This document does not choose the next autonomous ticket.

GitHub Issues are the canonical executable queue.

Use:

`docs/agents/issue-tracker.md`

for selection and state transitions.

Use:

`docs/agents/EXECUTION-LOOP.md`

for the normal execution lifecycle.

Use:

`docs/agents/SKILL-ROUTER.md`

for Superpowers / Matt Pocock / ECC routing.

Do not duplicate those workflows here.

---

# Updating this file

Update `PROJECT-STATUS.md` when a material state transition occurs, such as:

- a named gate closes;
- a new gate becomes active;
- the current merged/released baseline changes materially;
- a genuine active blocker appears or is resolved;
- staging or production readiness materially changes.

Keep exact receipts in their appropriate durable artifacts when they are too detailed for this snapshot.

Do not append every test run or command.

Replace stale operational claims rather than accumulating contradictory snapshots.

---

# Current next step

The next work should remain inside the authoritative A9 scope.

Conceptually:

```text
verify exact A9 prerequisites
→ prove merged/deployed A9 source convergence
→ perform target-locked hosted actor/evidence execution
→ run required verification
→ close A9 only if every acceptance condition passes
```

If any step requires authority outside A9, stop at the exact boundary rather than crossing it.

---

# Core status invariant

```text
A7 is closed.
A8 is closed.
A9 is active.
Gate 3 staging reconciliation is still in progress.
Production is not yet authorized for normal execution.
Current claims require current evidence.
GitHub Issues define executable work.
Named-gate scope defines what may be mutated.
```
