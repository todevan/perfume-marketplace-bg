# Stage 01 — Orient

## Job

Reconcile live authority and preserve all unknown work before selecting one safe
issue workspace.

## Inputs

- [`../../../AGENTS.md`](../../../AGENTS.md)
- [`../reference/AUTHORITY.md`](../reference/AUTHORITY.md)
- Live GitHub issue, pull-request, ruleset, check, label, and branch state
- Live Git and worktree state
- One focused Engram retrieval under [`../reference/MEMORY.md`](../reference/MEMORY.md)

## Procedure

1. Fetch remote state without overwriting local work; inspect the canonical clone,
   branches, worktrees, active labels, open PRs, and CI.
2. Reconcile Engram hints and historical handoffs against live GitHub, Git, and
   repository evidence. Treat disagreement as stale context.
3. Discover the active instruction chain and verify the effective project toolchain
   from the intended worktree. Diagnose unavailable MCPs as tooling evidence and use
   deterministic fallbacks rather than restarting authorized work.
4. Apply [`../reference/ISSUE-CONTRACT.md`](../reference/ISSUE-CONTRACT.md) to the
   current issue or live selection. Never select from issue number, PR order, stale
   labels, old checkpoints, or historical plans.
5. Apply [`../reference/WORKTREES.md`](../reference/WORKTREES.md); reuse valid state
   or create the single issue worktree from freshly fetched main. A quarantined
   worktree is read-only evidence.
6. Continue with one eligible issue, or classify and report the exact blocker. Avoid
   repeated broad audits and questions answerable from live evidence.

## Output

One live-verified eligible issue, branch, and worktree with effective instructions
and tools known; otherwise one exact blocker classification and preserved state.

## Human gate

none — agent-owned

## Stop conditions

- No eligible issue exists.
- Live state exposes an unresolved owner decision or protected action.
- The only available workspace contains unclassified work that cannot be isolated.

