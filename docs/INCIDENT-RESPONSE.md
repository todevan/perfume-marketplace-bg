# Closed-beta incident response

## Purpose and authority

This runbook governs containment, investigation, repair, and recovery during an incident. It does not create a separate engineering workflow or grant blanket authority for provider, production, destructive, or adjacent named-gate mutations.

Incident severity and mutation risk are different classifications: P0–P3 describes urgency; R0–R3 and H1–H6 determine how each proposed mutation may proceed. A P0 incident does not itself authorize an R3 action.

Perform every narrow, reversible containment action already authorized by repository policy, preserve evidence, and escalate only the exact protected action. Superpowers remains the primary engineering process; other skills may contribute engineering-depth or specialist analysis without changing authority.

## Severity

| Level | Examples | Initial action |
|---|---|---|
| P0 | cross-account chat/profile leak, service secret exposure, destructive data loss | stop invites and writes, isolate, notify incident owner immediately |
| P1 | authentication bypass, unsafe original image public, moderator access outside a case, credible account takeover | disable affected path, preserve evidence, investigate before reopening |
| P2 | broken workflow without data exposure, delayed notification, recoverable upload failure | contain and repair in the next controlled release |
| P3 | cosmetic/accessibility defect without blocked critical flow | triage into the ordinary backlog |

## First 30 minutes

1. Create an incident ID, UTC timeline and named incident lead.
2. Preserve request IDs, Worker logs, Supabase audit/auth logs and moderation audit records. Do not paste secrets or unnecessary personal data into tickets.
3. Contain with the narrowest authorized control: revoke an affected session/token, suspend an affected account, pause a specific endpoint or isolate the affected deployment/resource.
4. For P0/P1, stop unrelated releases or mutations that could destroy evidence or complicate recovery.
5. Determine whether a credential is credibly exposed. Revoke or rotate the affected credential through its target-locked procedure; do not rotate unrelated credentials without evidence of shared exposure.

## Investigation and communication

- Determine affected users, records, time window and whether data was read, changed, deleted or merely exposed.
- Keep moderator chat access bound to an assigned `investigating` report; incident access does not justify general browsing.
- Use the approved incident contact and legal escalation matrix. GDPR/DSA/GPSR notification duties and timelines must be decided by qualified counsel using verified facts.
- Tell affected users only confirmed information: impact, actions taken, actions they should take and when the next update will arrive.

Preserve evidence proportionately. Keep secrets and unnecessary personal data out of issues, PRs, chat, and ordinary notes. Incident access does not justify unrestricted browsing of user conversations, profiles, Storage objects, or database rows.

Before a production or external-provider mutation, verify the exact target/environment, classify the action, determine whether an H1–H6 gate applies, and understand rollback or recovery. A named scope such as `A9 only` remains a hard mutation boundary during incident work.

## Recovery

1. Add a regression test reproducing the failure.
2. Repair through a reviewed forward change or migration.
3. Verify RLS with affected and unaffected roles, then verify Worker route guards and Realtime behavior.
4. Restore data/images only through `BACKUP-RESTORE.md`; do not overwrite a live target speculatively.
5. Reopen only the contained functionality after clean telemetry and any approval required by the governing risk/Human-Gate rules.

## Post-incident

Within the agreed internal window, document root cause, detection gap, timeline, user impact, remediation owner and due date. Remove evidence when its approved retention period ends, while preserving legally required audit records.

Post-incident improvements return to the normal GitHub Issues queue. Incident closure does not authorize unrelated hardening, provider changes, production work, or a second execution lifecycle.
