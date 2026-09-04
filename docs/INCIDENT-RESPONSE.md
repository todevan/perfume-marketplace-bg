# Aromatika incident response

## Purpose and authority

This is the operational runbook for containing, investigating, and recovering from security, privacy, availability, and data-integrity incidents before and after public launch.

It does not create a separate execution framework or override repository authority.

During incident work, follow this order:

1. `AGENTS.md` and authoritative repository/project documentation.
2. The explicitly authorized environment, issue, gate and task scope.
3. `docs/agents/WORKFLOW.md` and `docs/agents/SECURITY.md`.
4. The selected Agent System V2 stage contract.
5. Matt Pocock skills for shaping or deep engineering reasoning when useful.
6. Superpowers for tactical debugging, TDD, verification, and review.
7. ECC or platform-specific skills for specialist security, backend, E2E, Supabase, Cloudflare, GitHub or similar work.
8. Repository-defined verification and release gates.

Do not start a second competing planning, debugging, TDD, execution or completion loop for an incident.

A named incident authorizes investigation and the minimum containment required by its existing risk/scope rules. It is not blanket permission for unrelated provider changes, production mutations, destructive recovery or adjacent named-gate work.

## Incident severity vs mutation risk

Incident severity and change risk are separate classifications.

- `P0`–`P3` describe how urgently the incident must be handled.
- `R0`–`R3` describe the risk and authorization requirements of each proposed mutation.

A `P0` incident does not automatically authorize an `R3` action.

Routine, narrow, reversible containment already permitted by repository policy should proceed autonomously. Actions that cross a protected R3 production, provider-control, policy, spending, or destructive-recovery boundary still require the exact owner decision or action defined by current authority.

When immediate containment and an R3 boundary are both relevant, perform every safe authorized containment action first, preserve evidence, and escalate the protected action without treating this runbook as permission to bypass the boundary.

## Severity

| Level | Examples | Initial action |
| ----- | -------- | -------------- |
| P0 | cross-account chat/profile leak, confirmed service-secret exposure with material access, destructive data loss, active widespread account compromise | contain immediately, preserve evidence, stop affected writes/access where safely authorized, notify the incident owner |
| P1 | authentication bypass, unsafe original image publicly reachable, moderator access outside an assigned case, credible targeted account takeover | disable or isolate the affected path where safely authorized, preserve evidence, investigate before reopening |
| P2 | broken workflow without data exposure, delayed notification, recoverable upload failure | contain if needed and repair through the next controlled release |
| P3 | cosmetic or accessibility defect without a blocked critical flow or security/privacy impact | triage into the ordinary GitHub Issues queue |

Escalate severity when new evidence shows broader access, sensitive-data exposure, credential compromise, destructive modification or a larger affected population.

Do not downgrade an incident merely because the visible symptom has stopped.

## First response

1. Create an incident ID, UTC timeline and named incident lead.
2. Record the currently authorized environment, issue/gate scope and known affected surface.
3. Preserve relevant request IDs, Worker logs, Supabase audit/auth evidence, moderation audit records and deployment identifiers before changing state where practical.
4. Do not paste secrets, authentication material or unnecessary personal data into GitHub issues, pull requests, chat logs or ordinary incident notes.
5. Apply the narrowest safe containment already authorized for the affected environment and resource.
6. For P0/P1, stop unrelated releases and mutations that could destroy evidence or complicate recovery.
7. Notify the designated incident owner/contact promptly, but do not delay routine authorized containment while waiting for acknowledgement.
8. Classify every non-trivial mutation separately as `R0`, `R1`, `R2`, or `R3` and apply the current risk controls.

Examples of narrow containment can include, when authorized:

- revoking a compromised session or token;
- suspending the affected account;
- denying access to a compromised application path;
- disabling a specific unsafe feature;
- stopping a broken background operation;
- isolating an affected object or record;
- temporarily stopping the affected public registration/onboarding path when that path itself is implicated.

Do not disable unrelated functionality merely because it is easy to reach operationally.

## Credential exposure

Treat a credential as compromised when there is credible evidence that its secret value became accessible outside its intended trust boundary.

Immediately:

1. Stop further propagation of the exposed value.
2. Preserve enough evidence to establish where and when exposure occurred without copying the secret unnecessarily.
3. Identify the exact credential, environment, privileges and services it can reach.
4. Determine whether there is evidence of unauthorized use.
5. Revoke or rotate the affected credential using the documented, target-locked procedure when that mutation is authorized.
6. Update dependent configuration through the normal controlled path.
7. Verify that the old credential no longer works and that the replacement is scoped correctly.

Do not rotate unrelated credentials by default. Rotate additional credentials only when shared trust, shared storage, shared exposure or other evidence makes their compromise credible.

Production/provider credential rotation is still a protected mutation when repository policy classifies it that way. This document does not grant blanket authority to mutate Cloudflare, Supabase, email, Turnstile or other provider configuration.

Never use staging credentials as authority for production actions.

## Investigation

Establish verified facts before broad remediation.

Determine:

- affected users and accounts;
- affected records and storage objects;
- affected environment;
- earliest and latest known incident time;
- whether information was merely reachable, actually read, changed, deleted or exported;
- whether authentication or authorization controls were bypassed;
- whether a credential or session was abused;
- whether the incident crosses account, tenant, moderation or environment boundaries;
- whether production is affected or only local/staging;
- whether prior evidence or current named-gate work has been invalidated.

Prefer evidence from authoritative logs, database state, reproducible requests and repository history over assumptions.

For debugging:

Use Superpowers systematic debugging as the tactical diagnosis loop.

Matt `diagnosing-bugs`, `domain-modeling` or `codebase-design` may be used when deeper causal or architectural reasoning is useful.

ECC security, backend, Supabase, Cloudflare, Playwright/E2E or other relevant specialist skills may provide specialist analysis.

These layers support the incident investigation; they do not replace the repository execution loop or create independent completion criteria.

## Security and privacy boundaries

Incident response does not relax ordinary least-privilege rules.

- Keep moderator chat access bound to an assigned `investigating` report or other explicitly authorized case.
- An incident does not justify unrestricted browsing of user conversations, profiles, storage objects or database rows.
- Access only the minimum user data needed to establish impact and complete authorized remediation.
- Do not copy production personal data into local or staging environments as a debugging shortcut.
- Preserve legally or operationally required evidence without retaining unrelated personal data.
- Keep secrets and sensitive evidence out of public or broadly accessible issue/PR history.

If resolution requires a legal, privacy, business, or policy decision, stop at the applicable R3 owner-decision boundary rather than inventing the decision inside the incident.

GDPR, DSA, GPSR or other statutory notification duties and timelines must be determined from verified facts through the project's applicable legal/privacy escalation boundary.

## Production and provider mutations

Incident response is not blanket production authority.

Routine investigation, evidence preservation and reversible containment should continue autonomously where already permitted.

Before a production or external-provider mutation, determine:

- whether the action is required for immediate containment;
- whether a narrower authorized control exists;
- its `R0`–`R3` classification;
- whether an R3 protected owner decision or action applies;
- whether the target and environment are positively verified;
- whether rollback or recovery is understood.

Use target-locked tooling for hosted Supabase operations.

Never treat a remembered project name, credential, environment variable or old provider reference as sufficient target proof.

Shared hosted database migrations are forward-only. Do not use remote database reset, migration-history rewriting or destructive repair as normal incident remediation.

If destructive recovery is genuinely required, stop at the protected R3 boundary and use the documented recovery process rather than improvising.

## Active tasks and incidents

An incident may justify pausing active work when continuing would increase harm, alter evidence, or make recovery harder.

It does not silently expand that gate's mutation scope.

An explicitly scoped task remains a strict mutation boundary. Incident investigation may identify a required adjacent provider or protected action, but that action requires its own authorization before mutation.

Document any incident-driven interruption clearly enough that the original task can later determine whether previous evidence remains valid.

## Repair

Once the failure mechanism is understood:

1. Create or update the canonical GitHub Issue for executable remediation work.
2. Add a regression test that reproduces the failure when technically appropriate.
3. Use the selected Agent System V2 stage contract for the repair.
4. Use Matt skills where they materially improve shaping, diagnosis, domain reasoning, or design.
5. Use Superpowers tactically for TDD, systematic debugging, verification, or review.
6. Use ECC/platform specialists for the relevant technical domain.
7. Prefer a narrow reviewed forward code/configuration change or forward migration.
8. Do not bundle unrelated cleanup or opportunistic redesign into the incident repair.
9. Apply the current `R0`–`R3` implementation, verification, merge, and owner-action rules.

R0/R1 incident fixes may proceed through normal autonomous review, verification and auto-merge rules.

R2 work may merge autonomously only after the required specialist review, adversarial security review, deterministic security checks, and full CI all pass.

R3 protected production, destructive, spending, commercial-term, or policy actions require the owner involvement defined by `AGENTS.md` and `docs/agents/SECURITY.md`.

## Verification

Before declaring the technical incident repaired, verify the affected boundary and nearby security invariants.

As applicable:

- reproduce the original failure before the fix;
- confirm the regression test fails for the expected reason;
- apply the repair;
- confirm the regression test passes;
- verify affected and unaffected RLS roles;
- verify authentication and authorization route guards;
- verify moderator/case access boundaries;
- verify storage object visibility and sanitization;
- verify Realtime behavior;
- verify session/token invalidation where relevant;
- verify the exact hosted target before hosted checks;
- run repository-defined unit, integration, E2E, security and release checks required by the changed surface.

Independent review and final verification remain separate completion gates. A plausible root-cause explanation is not sufficient evidence of closure.

## Data and image recovery

Restore database data or finalized listing images only through `BACKUP-RESTORE.md`.

Do not:

- overwrite a live target speculatively;
- perform a remote reset as normal remediation;
- rewrite hosted migration history to force convergence;
- restore an unverified backup directly into production;
- treat a PostgreSQL backup as containing Storage objects;
- restore objects without validating their expected integrity/provenance.

A recovery operation must respect the target environment, backup set, encryption material, retention rules, and risk classification applicable to that action.

## Reopening

Reopen an affected path only after:

1. the immediate cause is understood sufficiently to make reopening safe;
2. required remediation is deployed;
3. regression and repository verification pass;
4. affected authorization/privacy boundaries have been rechecked;
5. telemetry/logs show no continuing failure during the controlled observation window;
6. any required R3 owner decision or action has been satisfied.

Re-enable only the functionality that was contained.

Do not reintroduce legacy invite-only or SMS/phone activation requirements as an incident workaround for normal users. Current regular-user activation remains public email/password registration with email confirmation. Staff/admin MFA/AAL2 requirements remain mandatory.

Where the incident did not cross an R3 boundary, routine reopening does not require new owner approval solely because an incident occurred.

## Communication

Communicate only verified facts.

For affected-user communication, distinguish clearly between:

- what happened;
- what data or functionality was affected;
- what has been confirmed versus still being investigated;
- what containment/remediation has occurred;
- what action, if any, the user should take;
- when another update is genuinely expected.

Do not speculate about attacker identity, legal conclusions, data access or root cause.

Use the approved incident contact and applicable legal/privacy escalation path for external notifications.

## Closure

An incident can be operationally closed when:

- containment is no longer required;
- the affected path is safely restored or intentionally remains disabled;
- required repair and verification have completed;
- required R3 owner decisions or actions have been satisfied;
- follow-up work has a canonical GitHub Issue and owner/state;
- evidence needed for audit, security or legal purposes is retained appropriately;
- temporary access or containment controls have been removed or intentionally documented.

Closing the incident does not automatically close related product, legal, security-hardening or follow-up engineering issues.

## Post-incident

Within the agreed internal window, document:

- incident ID and severity;
- verified timeline;
- root cause;
- affected environment and users/data;
- detection gap;
- containment actions;
- remediation;
- verification evidence;
- R3 owner decisions or risk escalations used;
- follow-up GitHub Issues, owners and due dates.

Remove temporary evidence when its approved retention period ends while preserving legally or operationally required audit records.

Post-incident improvements return to the normal GitHub Issues queue and current workflow. The incident itself is not continuing authorization for unrelated hardening, provider changes, or production work.
