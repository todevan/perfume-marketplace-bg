# Worktree Safety

Create active worktrees under the user's project worktree parent, not temporary
directories, so project tooling can bind to the correct checkout. Each CodeGraph-aware
worktree owns its own index; never copy, symlink, or reuse another checkout's index.

## Active rule

Exactly one branch/worktree receives active product edits for the one `agent:active`
issue. Fetch before branching and start from verified remote main. Preserve the
canonical clone when dirty; never stash, reset, clean, pull over, or check out over
unknown local state. Quarantined and historical worktrees are inspection-only.

## Inventory

Before cleanup, record privately for every worktree:

- exact path, branch, HEAD, and lock reason;
- tracked status and untracked files;
- commits unique from remote main;
- associated issue and PR with live state;
- merge/supersession evidence;
- running process or open-file evidence where practical;
- private proof, browser, credential, or manifest artifacts;
- classification: `active`, `valid blocked`, `merged and removable`, `historical
  archive`, `dirty/unknown`, or `stale metadata only`.

## Removal gate

A worktree is removable only when all are proven:

1. Associated work is merged, closed, or explicitly superseded.
2. No unique commit requires preservation.
3. Tracked state is clean and no untracked file remains.
4. No active process or lock requires preservation.
5. No private proof artifact is needed for recovery or audit.
6. Canonical remote state exists.
7. Exact-path removal is safe.

Then use `git worktree remove <exact-path>` and `git branch -d
<exact-merged-branch>`. Run `git worktree prune --dry-run` before pruning stale
metadata. A closed PR alone never proves a branch is disposable.

Never use `git clean -fd`, `git reset --hard`, `rm -rf <worktree>`, or `git worktree
remove --force` against an unclassified or dirty worktree.

## Dirty or unknown state

Before any cleanup, create a private mode-700 local archive containing, as applicable,
a Git bundle of unique commits, tracked diff patch, untracked files, SHA-256 manifest,
and README with source path, HEAD, and classification. Keep secrets out of the
repository and GitHub. A snapshot enables investigation; it does not authorize
deletion. Reclassify against the removal gate.

For a completed hosted-proof worktree, delete credential-bearing transient artifacts
only under its proof cleanup contract and retain only the intentionally sanitized
terminal record. Preserve a superseded tooling worktree until useful changes are
ported, supersession is live-recorded, and every removal criterion passes.

