# Issue Contract

## Executable issue

A GitHub issue authorizes implementation only when all are true:

- it is open and owner approval is recorded;
- outcome and testable acceptance criteria are clear;
- scope and exclusions are explicit;
- dependencies are identified and live-verified;
- changed-surface risk and required verification are defined;
- no product, architecture, legal, commercial, spending, or protected-action
  decision remains unresolved.

Preserve owner-authored approval and decision text. Add agent clarification in
comments rather than rewriting approved intent. Re-read the live issue and approval
before implementation and before final review/merge. A material scope or decision
change requires renewed approval; deterministic engineering repair inside approved
scope does not.

The issue normally is the specification. Create no second queue, duplicate spec,
implementation plan, SDD artifact, roadmap, or ticket tree for executable work.

## Active state and scope

At most one product issue carries `agent:active`. Exactly one is required only while
active product implementation is underway, and exactly one issue branch/worktree then
receives product edits. Zero active product issues is valid while idle, after closure,
when no eligible next issue is authorized, and during an explicitly authorized
isolated tooling migration. That migration is not a standing parallel lane.

Every changed tracked file maps to an acceptance criterion, required test, mandatory
configuration/documentation update, or an in-scope defect needed for the security or
functional correctness of a directly modified path. Fix unrelated non-P0 defects in
a separate issue. Interrupt for P0 security/data-loss risk. Reject speculative
cleanup and enhancements.

## Blocker classes

Classify every apparent blocker before escalation:

**A — Product, architecture, legal, or commercial decision.** Ask the owner one exact
question with a recommendation.

**B — Human credential, CAPTCHA, or protected external action.** Prepare everything
else, then request only the true boundary action with one exact instruction.

**C — Deterministic engineering defect inside approved scope.** Repair autonomously
and add regression evidence; no new owner authorization is required.

**D — Transient CI or provider-read infrastructure failure.** Preserve the exact
candidate and recheck once after fresh recovery evidence. Keep application code,
dependencies, fail-closed behavior, audits, and required checks unchanged.

**E — Unsupported local tooling/runtime.** Use the repository container, CI, or safe
remote-browser route. Avoid broad host surgery during product work.

**F — Uncertain stateful provider mutation.** Stop and read fresh provider state.
Resolve only through the exact manifest and cleanup/recovery contract; never retry
blindly.

**G — P0 security/data-loss risk.** Preserve a deterministic checkpoint and interrupt
through the P0 procedure in [`../SECURITY.md`](../SECURITY.md).

An issue remains authorized until it passes, a genuine owner decision appears, the
external transaction envelope is exhausted, a protected action is reached, the owner
stops it, or a safety policy requires interruption. Repair count alone is not a
blocker.
