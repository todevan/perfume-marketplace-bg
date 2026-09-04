# Agent System Map

## Purpose

This directory is the progressive-disclosure map for repository work. Start at
[`../../AGENTS.md`](../../AGENTS.md), then load only the current stage contract and
the references it names. The numbered stages describe one issue lifecycle; they do
not create a second queue or require one session per stage.

## Stages

| Stage | Owns | Handoff |
| --- | --- | --- |
| [`01-orient`](01-orient/CONTEXT.md) | Live GitHub, Git, worktree, instruction, memory, and tool reconciliation | One eligible issue and safe workspace, or an exact blocker |
| [`02-shape`](02-shape/CONTEXT.md) | Clarity route, decisions, acceptance map, journey, risk, exclusions, and proof needs | Executable issue contract |
| [`03-implement`](03-implement/CONTEXT.md) | Reproduction, failing test, minimum root-cause repair, and focused regression evidence | Implemented working tree |
| [`04-verify`](04-verify/CONTEXT.md) | Pre-freeze evidence, exact candidate, final review, CI, and candidate-delta handling | Verified exact SHA |
| [`05-hosted-proof`](05-hosted-proof/CONTEXT.md) | Conditional provider preflight, bounded transaction, journey proof, and cleanup | Exact-SHA proof or safe failure record |
| [`06-complete`](06-complete/CONTEXT.md) | PR, merge, issue closure, status, memory, cleanup, and handoff | Reconciled closed work |

Stages are sequential but not ceremonial. A clear local R1 issue may cross several
stages in one session and skip hosted proof. Re-enter the earliest stage whose
output became invalid when live evidence or the candidate changes.

## Conditional references

- Resolve authority conflicts with [`reference/AUTHORITY.md`](reference/AUTHORITY.md).
- Test issue eligibility and classify blockers with
  [`reference/ISSUE-CONTRACT.md`](reference/ISSUE-CONTRACT.md).
- Select workflow skills with [`reference/SKILLS.md`](reference/SKILLS.md).
- Use Engram under [`reference/MEMORY.md`](reference/MEMORY.md).
- Create, preserve, or remove worktrees under
  [`reference/WORKTREES.md`](reference/WORKTREES.md).
- Select models and tools with
  [`reference/MODELS-AND-TOOLS.md`](reference/MODELS-AND-TOOLS.md).
- Load [`SECURITY.md`](SECURITY.md) for R2/R3 work.
- Load [`reference/HOSTED-PROOF.md`](reference/HOSTED-PROOF.md) only when external
  journey evidence is required.
- Load product, design, architecture, launch, or business references only when the
  active issue touches that concern.

## State ownership

- **GitHub:** the only engineering queue, issue approval and scope, live labels,
  pull requests, reviews, checks, and closure.
- **Repository:** durable operating contracts, product and architecture facts,
  deterministic validation, templates, and verified current truth in
  [`../PROJECT-STATUS.md`](../PROJECT-STATUS.md).
- **Engram:** focused continuity and sanitized decisions/checkpoints; it is never
  authority and must be verified against live state.
- **Archives and postmortems:** dated evidence and reusable learning, never current
  status or startup authority.

Compatibility files in this directory preserve old links. Each is a concise pointer
to one canonical home; no compatibility file may carry a second policy body.

