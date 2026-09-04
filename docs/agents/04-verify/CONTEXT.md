# Stage 04 — Verify

## Job

Form and prove one materially final candidate before hosted proof, merge, or closure.

## Inputs

- Stage 03 implemented working tree and acceptance map
- Live issue approval, exclusions, base branch, and required checks
- Risk gate from [`../SECURITY.md`](../SECURITY.md) when applicable
- Effective tool/config rules in
  [`../reference/MODELS-AND-TOOLS.md`](../reference/MODELS-AND-TOOLS.md)

## Procedure

1. Finish all deterministic pre-freeze work and record: base, HEAD, and tree SHAs;
   branch; clean tracked and untracked status; changed-file/acceptance map; effective
   project configuration identity; lockfile state; proof tool versions; nonzero
   expected test discovery; focused and full required local gates; hosted provider
   schema/capability preflight when needed; one-source input/display fixture; and no
   pending acceptance-critical documentation change.
2. Freeze the exact candidate only after that record is complete. A candidate exists
   to prove finished work, not to attract intermediate reviews.
3. Run one final review stage against the exact SHA: one fresh engineering/coherence
   review for R1; one fresh engineering review and one fresh adversarial/security
   review against the same SHA for R2.
4. Batch verified blockers into one repair. If the SHA changes, rerun affected
   deterministic gates and obtain focused final-SHA re-attestation from every
   required reviewer; preserve analysis of unchanged surfaces.
5. Run required CI against the exact SHA. Treat registry, advisory, and network
   outages as infrastructure: preserve the candidate and recheck once after fresh
   recovery evidence. Keep audits, fail-closed jobs, dependencies, and required
   checks intact.
6. If a change would create provider/operator or other R2 behavior, de-scope it when
   possible; otherwise reclassify before continuing.

## Output

An exact candidate SHA and tree with deterministic gates, required final-SHA reviews,
and exact-SHA CI proven; or an unchanged safely blocked candidate.

## Human gate

none — agent-owned

## Stop conditions

- A required deterministic gate, final-SHA review, or CI check remains failed.
- The risk surface materially changes and the required gate is unavailable.
- A genuine owner decision, protected action, or safety interruption appears.
