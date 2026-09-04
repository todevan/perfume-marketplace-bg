# Stage 05 — Hosted Proof

## Job

Prove an exact candidate through one authorized, provenance-bound hosted transaction
and verify exact cleanup.

## Inputs

- Stage 04 exact candidate and CI evidence
- An owner-authorized transaction envelope
- [`../reference/HOSTED-PROOF.md`](../reference/HOSTED-PROOF.md)
- [`../templates/HOSTED-TRANSACTION.md`](../templates/HOSTED-TRANSACTION.md)
- [`../SECURITY.md`](../SECURITY.md)

## Procedure

1. Skip this stage for local-only issues. Otherwise perform read-only capability and
   schema preflight before creating resources.
2. Create the private mode-600 manifest outside the repository; bind exact candidate,
   provider targets, ownership, fixtures, run window, attempt limit, allowed human
   boundary, cleanup, and forbidden resources.
3. Persist intent before each mutation, perform it once, read back exact state, then
   advance the manifest. An uncertain outcome triggers fresh inspection rather than
   retry.
4. Prepare any CAPTCHA or credential handoff in one persistent transaction-bound
   visible browser context with capture disabled or redacted on sensitive forms. Ask
   for one exact human action and continue immediately in the same context.
5. Run the required journey matrix against the exact deployment identity. Use safe
   correlation/stage markers to locate generic failures without logging sensitive
   data.
6. Classify failure honestly. Perform only exact, idempotent, provenance-bound
   cleanup and independent absence readback; retain only a sanitized terminal record.

## Output

Exact-SHA hosted proof and `cleanup_verified`, or a `proof_failed_safe` record with
the exact blocker and no ambiguous pending mutation.

## Human gate

none — agent-owned except the exact CAPTCHA, credential, or protected action already
named in the transaction envelope

## Stop conditions

- Target identity, ownership, cost, candidate identity, or provider contract is not
  exact.
- A stateful outcome is uncertain.
- The transaction attempt limit or authorized envelope is exhausted.
- Cleanup cannot be proven without deleting unknown resources.

