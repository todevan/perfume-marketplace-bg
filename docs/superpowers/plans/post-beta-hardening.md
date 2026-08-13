# Post-Beta Hardening Catalogue

**Role:** Deferred hardening reference.  
**Execution authority:** GitHub Issues and current gate/status documents.

These items were intentionally kept outside the immediate beta-gate remediation unless new evidence promoted them.

This document is **not** the canonical executable queue. GitHub Issues are the canonical queue for work that is ready to execute. An item appearing here does not mean it is currently open, ready, authorized, or still unfixed.

Before acting on any item:

- verify that the concern still exists on the current candidate;
- use or create the corresponding canonical GitHub Issue;
- assign the current priority, `R0`–`R3` risk, dependencies, and agent state;
- respect the active named-gate scope;
- use the applicable H1–H6 Human Gate when product, legal, privacy, business, R2 merge, or protected-action authority is required;
- collect fresh verification rather than relying on this historical catalogue.

Superpowers remains the process authority. Matt Pocock skills may provide deeper diagnosis, domain/design reasoning, or review where useful. ECC/platform specialists may support security, backend, Supabase, Cloudflare, E2E/Playwright, GitHub, documentation, or other specialist surfaces. None of those systems independently make an item executable or redefine project truth.

## 1. Messaging abuse and moderation semantics

### Deferred concern

Define and enforce:

- directional block semantics;
- whether blocked users can send;
- visibility of existing conversations;
- message edit window;
- delete/tombstone semantics;
- immutable moderation evidence or snapshots;
- retention;
- spam/rate thresholds;
- block/send race behavior.

Critical invariants should be enforced in PostgreSQL/RLS/RPC/trigger logic where they must hold against a hostile authenticated client.

### Decision boundary

Do not infer these semantics from implementation convenience.

Where behavior remains unresolved, use the applicable H1 product and/or H2 legal/privacy/business Human Gate before implementation.

The decision should cover, as applicable:

- whether a block prevents one-way or both-way future contact;
- whether open offers/deals change when a participant blocks another;
- whether historical messages remain visible;
- whether users can edit or delete messages after a report;
- whether moderation stores immutable snapshots/revisions;
- normal and reported-message retention;
- moderation/legal holds.

After the decision is recorded in the authoritative project decision source, implementation becomes ordinary engineering subject to its current risk classification.

## 2. Release-compatible rollback

### Deferred concern

Replace any permanently hard-coded Worker rollback target with release compatibility evidence associating, at minimum:

- Git SHA;
- Worker version/deployment identifier;
- database migration inventory or deterministic migration hash;
- relevant runtime/provider inventory;
- smoke result.

A rollback target must mean:

```text
last known-good release compatible with the current database
```

not merely:

```text
an older Worker that passed at some point
```

### Safety boundary

Hosted database migrations remain forward-only.

A rollback mechanism must never imply permission to:

- revert applied hosted migrations in place;
- rewrite migration history;
- reset a hosted database;
- deploy an application version whose compatibility with the current schema is not established.

Actual Cloudflare/staging mutations require the current issue/gate authority and applicable Human Gate. Production remains protected separately.

## 3. GitHub Actions immutable pinning

### Deferred concern

Replace mutable external GitHub Actions tags with reviewed full commit SHAs while retaining human-readable version comments.

For example, avoid relying solely on forms such as:

```text
actions/checkout@v4
actions/setup-node@v4
pnpm/action-setup@v4
```

when the current security/release policy requires immutable references.

### Verification rule

Never invent action SHAs from memory.

Resolve the exact reviewed release to a full commit SHA through a trusted source/environment, update the workflow, and run the repository's workflow/CI contract verification.

Treat this as supply-chain hardening, not permission to redesign CI.

## 4. Documentation reconciliation

### Deferred concern

After verified source or operational state changes:

- refresh `docs/PROJECT-STATUS.md` when current project state materially changes;
- refresh `docs/ARCHITECTURE.md` when durable architecture actually changes;
- remove stale current-state findings that have been genuinely resolved;
- record suite counts/results only from fresh evidence for the candidate being described.

### Documentation discipline

Do not rewrite historical audits, gate receipts, manifests, or dated reviews to make old findings disappear.

Historical artifacts should continue to describe what was true at the recorded snapshot.

`docs/PROJECT-STATUS.md` should remain concise and current rather than becoming a session diary.

Routine engineering history belongs in GitHub Issues, pull requests, review, and CI.

## 5. Report degradation behavior

### Deferred concern

Consider decoupling text-only moderation reports from privileged evidence-upload infrastructure so that a user can still submit a text report when optional evidence processing is unavailable.

Desired boundary if this behavior is currently approved:

- text-only report uses the ordinary authenticated report path;
- evidence-specific infrastructure is not required when no evidence is submitted;
- evidence-bearing reports continue to fail closed if allocation, sanitization, finalization, or privileged evidence services are unavailable;
- failure of optional evidence processing must not silently weaken evidence security.

### Product/security boundary

If current product documentation already decides that text-only reporting must remain available during evidence degradation, implementation can follow that contract.

If the desired degradation behavior is genuinely unresolved, use the applicable H1/H2 Human Gate rather than deciding it inside this catalogue.

## Promotion rule

A catalogue item may be promoted into active work when fresh evidence shows that it:

- directly enables an exploit;
- breaks a critical marketplace lifecycle;
- blocks the active gate;
- makes safe recovery impossible;
- becomes a dependency of an already authorized issue.

Promotion means:

1. reproduce or verify the current problem;
2. create or update the canonical GitHub Issue;
3. assign current priority, risk and dependencies;
4. apply `hosted-required` or `human-gate` where appropriate;
5. execute through the normal autonomous engineering process.

Do not silently expand the scope of an active gate because a related item exists in this document.

## Historical-status rule

Unchecked or unresolved wording in this file does not prove that an item remains open.

Likewise, a historical statement that an item was deferred does not prove that later work closed it.

Current truth must come from:

```text
AGENTS.md
→ authoritative project docs
→ PROJECT-STATUS / active gate docs
→ canonical GitHub Issue
→ fresh repository/provider evidence
```

## Reuse rule

Keep this file as a compact reference for hardening themes that may matter again.

Do not use it to:

- select work ahead of the GitHub ready frontier;
- bypass dependencies;
- authorize hosted or production mutations;
- reopen completed gates;
- infer product/legal decisions;
- start a second execution workflow.

If all useful items are eventually represented by resolved/current GitHub Issues and no longer provide durable reference value, archival or deletion should be an explicit documentation-maintenance decision rather than an automatic cleanup step.