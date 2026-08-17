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
1. strong-enough implementation;
2. relevant engineering specialist;
3. independent strong engineering review;
4. independent adversarial security review;
5. deterministic security tests;
6. database/RLS tests when authorization changes;
7. browser/E2E tests when user journeys change;
8. payment/webhook idempotency and forgery tests when monetization changes;
9. dependency/static checks applicable to the change;
10. full required CI.

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
- Refund/cancellation state must remain auditable.
- Never log/store card details when the provider can retain them.

## Uploads/evidence
Preserve:
`quarantine -> validate real MIME/content/dimensions/limits -> re-encode/sanitize -> strip metadata -> finalized sanitized object -> delete private original according to policy`

Never trust filename or browser-declared MIME alone.

## Secrets/environments
- Never commit secrets.
- Never paste secrets into issues, PRs, logs, or chat.
- Verify exact provider/project/environment before hosted mutation.
- Staging and production must remain distinguishable and fail closed.
- Production/destructive/provider actions may be R3 even when repository implementation is complete.

## Staff access
Staff/admin MFA/AAL2 remains mandatory.

## Security review failure
A security finding blocks completion until disproved with evidence or fixed and covered by regression tests.
Never waive a finding merely to ship.

## R3 protected actions
Agents may prepare and verify repository-side work, rollback steps, and exact instructions. The real external/destructive/legal/spending/launch action remains owner-controlled.
