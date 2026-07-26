# Closed-beta incident response

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
3. Contain with the narrowest available control: revoke an invite/session, suspend an account, pause an endpoint or disable the Worker deployment.
4. For P0/P1, stop the invitation ramp and all production changes unrelated to containment.
5. Decide whether credentials must be rotated. Rotate service, Resend, Twilio, Turnstile and Cloudflare keys independently.

## Investigation and communication

- Determine affected users, records, time window and whether data was read, changed, deleted or merely exposed.
- Keep moderator chat access bound to an assigned `investigating` report; incident access does not justify general browsing.
- Use the approved incident contact and legal escalation matrix. GDPR/DSA/GPSR notification duties and timelines must be decided by qualified counsel using verified facts.
- Tell affected users only confirmed information: impact, actions taken, actions they should take and when the next update will arrive.

## Recovery

1. Add a regression test reproducing the failure.
2. Repair through a reviewed forward change or migration.
3. Verify RLS with affected and unaffected roles, then verify Worker route guards and Realtime behavior.
4. Restore data/images only through `BACKUP-RESTORE.md`; do not overwrite a live target speculatively.
5. Reopen invites in stages after clean telemetry and explicit incident-lead approval.

## Post-incident

Within the agreed internal window, document root cause, detection gap, timeline, user impact, remediation owner and due date. Remove evidence when its approved retention period ends, while preserving legally required audit records.
