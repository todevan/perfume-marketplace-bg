# Agent Security Rules

## Objective
Protect user data, paid entitlements, and marketplace trust through defense in depth. Fail closed when safety cannot be proven.

## R2 triggers
Treat a material change as R2 when it touches:
- authentication/session/registration/reset/MFA;
- RLS/authorization;
- staff/admin/moderator authorization;
- private user data or private Storage;
- uploads/evidence trust boundaries;
- chat/messages privacy;
- reports/blocking/moderation/retention;
- account deletion/export/anonymization;
- service-role use;
- `SECURITY DEFINER`;
- secrets/security configuration;
- cross-user visibility;
- paid listing/promotion entitlements;
- payment webhooks/provider callbacks;
- security-sensitive provider configuration.

## Mandatory R2 gate
R2 cannot merge until all applicable items pass:
1. focused deterministic security tests;
2. database/RLS and contract tests when authorization changes;
3. browser/E2E tests when user journeys change;
4. payment/webhook idempotency and forgery tests when monetization changes;
5. applicable dependency/static checks and full required CI;
6. one fresh independent engineering review;
7. one fresh independent adversarial security review against the same candidate SHA.

Specialists may contribute implementation or evidence inside this lifecycle; they
do not create an additional approval stage. After any candidate change, both
required reviewers explicitly attest the final SHA. Focused re-review may limit
analysis to changed surfaces but cannot carry an earlier-SHA approval forward.

The owner does not approve R2 code.

If required confidence cannot be established, do not merge.

## Authorization
- RLS/database policy is a security boundary.
- Inspect real migrations, policies, functions, grants, and Storage rules.
- Do not infer access control only from UI or TypeScript.
- Test hostile clients across ownership/cross-user boundaries.
- Service role is server-only and must never bypass the user authorization model.
- `SECURITY DEFINER` requires explicit privilege review and tests.

## Hostile-client examples
Where relevant, prove User A cannot:
- read User B's private record;
- modify User B's listing;
- read User B's private chat;
- access User B's private uploads/evidence;
- invoke moderator/admin actions;
- manipulate User B's deal;
- spoof ownership;
- grant themselves paid listing/promotion entitlements;
- bypass payment completion;
- escalate privileges through user-controlled fields;
- bypass ownership by direct API/database calls;
- obtain private URLs/secrets through error behavior.

## Paid entitlement rules
- Browser-controlled state never grants an entitlement.
- Create entitlements only from trusted server-side confirmation.
- Provider callbacks/webhooks must be authenticated according to the selected provider.
- Callback handling must be idempotent.
- Duplicate callbacks must not duplicate entitlements.
- Failed/abandoned payments must not create entitlements.
- Every entitlement lifecycle must be auditable and linked to trusted provider event identifiers for provider-originated transitions.
- Every entitlement transition must retain actor/source, provider event ID when applicable, timestamp, prior state, and resulting state.
- Never log/store card details when the provider can retain them.

## Uploads/evidence
Preserve:
`quarantine -> validate real MIME/content/dimensions/limits -> re-encode/sanitize -> strip metadata -> finalized sanitized object -> delete private original according to policy`

Never trust filename or browser-declared MIME alone.

## Confidential data
- Never log or publish emails, phone numbers, raw profiles, or private evidence.
- Quarantined evidence remains private and must never be exposed publicly.

## Secrets/environments
- Never commit secrets.
- Never paste secrets into issues, PRs, logs, or chat.
- Do not print or persist plaintext run credentials, session or refresh tokens, MFA secrets, provider response bodies, or secret-store contents in normal evidence or logs.
- Verify exact provider/project/environment before hosted mutation.
- Staging and production must remain distinguishable and fail closed.
- Production/destructive/provider actions may be R3 even when repository implementation is complete.

## Hosted mutation and cleanup

- Read-only inspection is not mutation authorization. Before a hosted/operator mutation, bind the exact target, run, release, ownership/provenance, and one permitted lifecycle boundary.
- Give a stateful runner only the capability required for that boundary; do not give it a general provider or deletion capability for convenience.
- After mutation, perform targeted read-back before recording manifest evidence, and record orchestration state only after that evidence is durable.
- If transport or provider outcome is uncertain, stop and inspect fresh. Do not retry automatically, widen scope, or infer success from local state.
- Cleanup and recovery are exact, provenance-bound, and idempotent. Never use wildcard, blanket, foreign-data, or ambiguous deletion.
- If ownership, coordinates, release identity, lifecycle state, or residual scope is ambiguous, fail closed and preserve the working system.
- Recovery is a separate explicit boundary, not an automatic fallback from normal cleanup. Destructive provider operations remain subject to the applicable R2/R3 authority.

Hosted proof additionally follows
[`reference/HOSTED-PROOF.md`](reference/HOSTED-PROOF.md) for transaction envelopes,
private manifests, provider capability preflight, persistent human browser handoff,
secret-safe observability, and exact cleanup evidence.

## Staff access
Staff/admin MFA/AAL2 remains mandatory.

## Security review failure
A security finding blocks completion until disproved with evidence or fixed and covered by regression tests.
Never waive a finding merely to ship.

## P0 interruption

When deterministic evidence shows an immediate security or data-loss risk:

1. stop modifying the current issue;
2. preserve a deterministic, non-secret checkpoint and the isolated worktree;
3. push only tracked material that is safe for remote storage;
4. record the exact interruption and remaining blocker in the live issue;
5. remove stale `agent:active` state from the interrupted issue;
6. create or identify the dedicated P0 issue and make it the only active issue;
7. resume the interrupted issue only after the P0 closes and live selection proves it
   remains eligible.

## R3 protected actions
Agents may prepare and verify repository-side work, rollback steps, and exact instructions. Before any destructive or irreversible owner action, verify the exact target, current backup/recovery evidence, and rollback limitations; if any is missing, fail closed and do not hand off the action. The real external/destructive/legal/spending/launch action remains owner-controlled.
