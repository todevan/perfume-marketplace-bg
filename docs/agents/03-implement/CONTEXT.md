# Stage 03 — Implement

## Job

Repair the approved behavior at its root cause with the smallest deterministic
change and regression evidence.

## Inputs

- Stage 02 executable issue contract and acceptance map
- The isolated issue worktree
- Current code, tests, and effective configuration
- [`../SECURITY.md`](../SECURITY.md) when the changed surface is R2/R3

## Procedure

1. Reproduce the discrepancy at the narrowest realistic seam.
2. Add the smallest deterministic failing test and observe the intended failure.
3. Implement the minimum root-cause repair; keep every changed file mapped to
   acceptance, required evidence, mandatory configuration/documentation, or a defect
   required for correctness of the directly modified path.
4. Observe focused green and run affected regressions. Confirm acceptance-critical
   test discovery rather than accepting a skipped or zero-test run.
5. Classify findings under the blocker classes in
   [`../reference/ISSUE-CONTRACT.md`](../reference/ISSUE-CONTRACT.md). Fix ordinary
   in-scope engineering defects autonomously; file unrelated non-P0 defects and
   interrupt only for a P0 security/data-loss risk.
6. Complete deterministic implementation work before review. Run no reviews in this
   stage. Keep transient CI or provider-read outages separate from code defects.

## Output

A minimal implemented working tree with focused green evidence, in-scope regressions,
and every changed file mapped to the approved issue.

## Human gate

none — agent-owned

## Stop conditions

- A newly discovered owner decision is required.
- A P0 security or data-loss risk requires the dedicated interruption procedure.
- A stateful provider outcome is uncertain and fresh readback cannot establish it.
