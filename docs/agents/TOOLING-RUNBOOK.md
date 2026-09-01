# Tooling Runbook (Aromatika)

## Purpose

This repository uses a dedicated tooling runbook for infrastructure-facing changes that do
not alter product behavior or data model logic.

This runbook is the canonical authority for:

- Matt Pocock / Superpowers / Codex orchestration decisions for tooling work
- Engram routing and retrieval policy
- Tool wrapper behavior and validation checks
- MCP routing, especially CodeGraph/Svelte/context7 decisions
- Review deduplication for tooling candidates

## When to use this runbook

Use this runbook when a tooling candidate is prepared while a product issue is in
`agent:active` state.

- Do not edit the active product issue branch or PR.
- Do not merge tooling changes into `main` until the active product issue closes.
- Keep pre-existing local repository drift untouched.
- Run the tooling work in an isolated branch/worktree created from `origin/main`.

## Startup order for tooling sessions

For substantial tooling work, do this in order:

1. Read the active issue only for **authorization scope** (`agent:active` + blockers).
2. Read this runbook and `AGENTS.md`.
3. Read `docs/agents/WORKFLOW.md` for lifecycle and risk gates.
4. Reconcile local branch/worktree state.
5. Confirm `.codex/config.toml` parses.
6. Validate wrapper routing contracts after any changes.
7. Run targeted tooling checks and produce a single immutable candidate.

## Process owner (choose one)

### One process owner only

Select one process owner per lifecycle pass:

- **Matt Pocock-oriented pipeline**: `grill-with-docs`, `domain-modeling`, `research`,
  `to-spec`, `to-tickets`, `code-review`.
- **Superpowers pipeline**: TDD, systematic debugging, worktree isolation,
  verification-before-completion, required reviews.

Do not run both process owners in parallel for the same lifecycle step.

## Review and verification policy

- R1 tooling: one engineering review on final candidate.
- R2 tooling: one independent engineering review + one independent adversarial security
  review against the same final SHA.
- Never create duplicate review loops for the same candidate.
- Prefer one deterministic repair pass.

## Tool routing rules (codified)

- **Engram**: retrieve project startup guidance by class, then issue-domain memory, then
  current authority, then live verification of time-sensitive facts.
- **CodeGraph**: use as primary structural source. Keep wrappers pinned to the repo root.
- **Svelte MCP**: use for Svelte/sveltekit structural and linting questions only when this
  work directly touches Svelte toolchain/config.
- **Context7**: enable only when source documentation lookup materially improves reliability
  for the change.
- **Vendor SKILL.md files**: read-only reference; do not edit.

## Delegation boundaries

- Do not add specs, plans, or roadmaps for existing approval.
- Do not add product/application/database logic in a tooling pass.
- Record unrelated defects as separate issue-level follow-ups, not this tooling candidate.

## Acceptance outputs

- Candidate branch + commit history.
- Validation artifacts showing:
  - `.codex/config.toml` parses,
  - wrapper bootstrap checks pass,
  - required routing checks for tools touched.
- PR ready for owner-approved merge queue.

## Stop conditions

Stop before merge only for:

- inability to isolate safely,
- local secret/confidentiality exposure risk,
- required destructive action that is not authorized,
- conflict with a higher-priority product or architecture decision.
