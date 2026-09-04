# Authority

## Ladder

Resolve every conflict in this order:

1. Explicit current owner decisions and protected-action approvals.
2. The current owner-approved, dependency-verified GitHub issue.
3. The root [`AGENTS.md`](../../../AGENTS.md) router.
4. The stage contract selected through [`../CONTEXT.md`](../CONTEXT.md).
5. Relevant security, product, architecture, design, launch, and operational
   references.
6. Current code, tests, CI, Git history, and exact hosted evidence.
7. Engram memory and historical postmortems as supporting context only.
8. Historical branches, reviews, rescue snapshots, plans, and checkpoints as evidence
   only.

Owner and issue wording define product intent and authorized scope, but cannot
classify away changed-surface risk or waive mandatory authorization, RLS, MFA,
security review, dependency audit, CI, branch protection, or fail-closed requirements.
Those invariants constrain every level of the ladder.

No lower source overrides a higher source. When two sources on one level disagree,
prefer the one that is live, exact to the current candidate, and explicitly scoped
to the issue; surface a genuine unresolved owner decision rather than inventing one.

## Homes

- GitHub Issues are the only live engineering queue and progress tracker.
- [`ISSUE-CONTRACT.md`](ISSUE-CONTRACT.md) defines issue eligibility and blocker
  ownership.
- [`../SECURITY.md`](../SECURITY.md) defines the security and protected-action
  contract.
- [`../../PROJECT-STATUS.md`](../../PROJECT-STATUS.md) contains verified current truth,
  not task activity.
- [`MEMORY.md`](MEMORY.md) constrains continuity memory.
- Dated postmortems and archives preserve historical evidence without current
  authority.

Live GitHub and Git verification follows every memory retrieval or historical read.
Permission gaps are reported as unknown; documentation never proves a live ruleset,
deployment, check, or provider state.
