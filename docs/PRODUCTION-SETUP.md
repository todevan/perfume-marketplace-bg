# Production setup for the pre-launch marketplace

## Purpose and authority

This runbook defines the engineering and operational setup for isolated staging and future production environments.

It does not replace:

- `AGENTS.md`;
- `docs/MASTER-PLAN.md`;
- `docs/PROJECT-STATUS.md`;
- `docs/ARCHITECTURE.md`;
- `docs/LAUNCH-GATES.md`;
- `docs/BACKUP-RESTORE.md`;
- `docs/STAGING-CREDENTIALS.md`;
- applicable plans under `docs/superpowers/plans/`;
- applicable policy under `docs/agents/`.

It is not legal, accounting or tax advice.

It is also not independent authorization to mutate a hosted provider.

Current GitHub issue scope, named gate scope, repository risk classification and Human Gates still apply.

In particular:

```text
staging runbook instruction
≠
authorization for unrelated staging mutation

production runbook instruction
≠
authorization for production mutation
```

Production/provider activation remains protected and must follow the repository's R3 and Human Gate rules.

---

# Current GitHub operating model

The canonical repository is:

`https://github.com/todevan/perfume-marketplace-bg`

The previous repository:

`todevan/remix-of-scent-exchange`

must remain untouched unless an explicit owner-authorized task says otherwise.

It is not:

- the canonical remote;
- a migration source;
- a deployment source;
- a backup source;
- a source of current release truth.

The current GitHub operating model may use repository secrets and manual staging dispatch without relying on every GitHub branch/environment protection feature.

The absence of GitHub enforcement does not weaken the repository release contract.

A successful push is not deployment authorization.

A merge is not proof of deployment.

A deployment is not proof of correct hosted provider state.

---

## Staging dispatch invariants

Staging deployment must use the exact authorized and verified source revision required by the active gate/release process.

Before dispatch, verify as applicable:

- intended commit SHA;
- intended tree/source;
- relevant tests and CI;
- clean candidate/worktree requirements;
- target environment identity;
- current known-good rollback target;
- provider prerequisites;
- named-gate scope.

Only the Cloudflare GitHub credentials explicitly required by the repository deployment workflow should live as GitHub repository secrets.

Runtime provider secrets belong in the corresponding hosted provider/environment unless a more specific repository contract explicitly requires otherwise.

Production GitHub credentials and production deployment paths must remain disabled until the applicable production gates and owner authorization permit them.

---

# Environment isolation

Use isolated environments.

| Environment | Data policy | Cloudflare runtime | Purpose |
|---|---|---|---|
| Local | synthetic only | local Wrangler/Vite | development and integration tests |
| Staging | synthetic/non-production only | `perfume-marketplace-bg-staging` | hosted migrations, provider reconciliation and E2E evidence |
| Production | real marketplace users only after launch authorization | separate production Worker/custom domain | controlled production launch |

Never copy production personal data into:

- local;
- staging;
- test fixtures;
- release artifacts;
- logs.

Use separate credentials and secrets for staging and production, including as applicable:

- Supabase;
- Resend;
- Turnstile;
- Cloudflare;
- webhook secrets;
- scheduler secrets;
- provider API credentials.

A staging secret must never be reused merely because the corresponding production provider has not yet been provisioned.

---

# Authorized hosted staging target

The authorized hosted staging Supabase target is:

| Property | Required value |
|---|---|
| Supabase project name | `perfume-marketplace-bg-staging` |
| Project ref | `nuhkpqjjyuygiemrxbdp` |
| Organization | `khazvscqabwvslnphbqp` |
| Region | `eu-central-1` (Frankfurt) |
| PostgreSQL major/status | `17` / `ACTIVE_HEALTHY` |

Run:

```bash
pnpm db:staging:verify-target
```

before every hosted staging database command for which the repository operator contract requires target verification.

The target guard must fail closed on conditions such as:

- missing or incorrect project link;
- previous/obsolete project ref;
- wrong organization;
- wrong region;
- unhealthy project;
- Supabase URL mismatch;
- Supabase key/project mismatch.

Do not disable or bypass target locking merely to make a gate proceed.

If the current hosted identity differs from this authority, stop and reconcile the mismatch before mutation.

---

# Hosted mutation scope

A correctly identified staging project is necessary but not sufficient authorization for mutation.

Before changing hosted state, establish:

```text
correct target
+
current GitHub issue
+
named gate/phase scope
+
applicable risk authority
+
required Human Gate status
```

For example, authorization for:

```text
A9 only
```

does not authorize:

- an A8 provider mutation;
- an A10 setup step;
- unrelated Auth cleanup;
- unrelated database migration;
- production configuration;
- opportunistic infrastructure changes.

If a prerequisite belongs outside the current scope, record the dependency and stop at that boundary rather than silently performing it.

---

# Environment provisioning invariants

## Supabase Auth

The intended regular-user product model uses public email/password signup.

For environments where registration is enabled by the active gate:

- public email/password signup may be enabled;
- anonymous signup remains disabled;
- email confirmation remains enabled unless a narrower authorized testing contract explicitly says otherwise;
- Site URL must use the exact authorized application origin;
- redirect allow-list must contain only approved authentication callback/confirmation targets.

Temporary gate-specific Auth state must follow the active reconciliation plan.

Do not interpret a temporary disabled signup setting as a return to invite-only product policy.

Legacy invitation behavior may remain only for explicitly supported operator/bootstrap compatibility.

---

## Worker isolation

Keep staging and production Cloudflare Workers separate.

The staging Worker is:

`perfume-marketplace-bg-staging`

Do not repurpose it as the production Worker.

Create or activate production runtime/domain infrastructure only when the production gates and protected-action authority permit it.

---

## Image processing

Cloudflare Images is the trusted normalization path for supported marketplace evidence where the architecture requires it.

Do not permit evidence publication through an untrusted raw-upload path.

When:

```text
IMAGE_PROCESSOR_MODE=disabled
```

flows that require trusted sanitization must fail closed rather than silently storing unprocessed evidence as finalized content.

Only enable:

```text
IMAGE_PROCESSOR_MODE=cloudflare-images
```

after the applicable binding/provider acceptance has passed.

---

## Staff MFA

Every admin and moderator must use the repository-defined MFA/AAL2 protections.

This applies to:

- application privileged behavior;
- Supabase access where applicable;
- upstream/provider administrative accounts where supported and required.

Do not weaken staff MFA to simplify hosted testing.

Synthetic moderators used by an authorized hosted gate must satisfy the same security invariants the gate intends to prove.

---

## Notification and cleanup functions

Deploy the required hosted functions only inside the authorized environment and gate.

Current architectural responsibilities include:

- `notification-email`;
- `upload-cleanup`.

Store their secrets through the provider's protected secret mechanism.

For Supabase Edge Function secrets, use the approved `supabase secrets` path rather than committing values.

The notification webhook must remain:

- INSERT-only where required by architecture;
- authenticated with a dedicated webhook secret;
- independent of the service-role key.

Send the dedicated webhook secret through the approved header.

Never place a Supabase service-role credential in a Database Webhook header.

---

# Secrets and configuration

Start from:

`.env.example`

and use:

`docs/STAGING-CREDENTIALS.md`

for staging provider/credential handling.

Local `.env*` files remain ignored and must not become durable secret storage.

Hosted Worker secrets belong in Cloudflare's protected environment configuration rather than:

- `wrangler.jsonc`;
- committed files;
- plaintext documentation;
- GitHub variables visible to pull requests.

Never commit a real credential, even temporarily.

---

## `keep_vars`

If the current `wrangler.jsonc` configuration uses:

```text
keep_vars: true
```

a code deployment may preserve provider variables/secrets already provisioned on that Worker.

Treat this as controlled infrastructure behavior, not as proof that the values are correct.

For every required environment variable or secret:

- know which provider/environment owns it;
- restrict who may mutate it;
- verify it after rotation when applicable;
- do not assume preserved means valid.

---

# Production invariants

Before any authorized production release, the intended production configuration must preserve at least the following product/security invariants:

- `PUBLIC_DEMO_MODE=false`;
- regular-user public email/password registration follows the current approved product policy;
- anonymous signup remains disabled;
- staff/admin MFA remains enforced;
- billing remains disabled until the paid-service gate explicitly passes;
- listing fees remain disabled until authorized;
- subscriptions remain disabled until authorized;
- boosts remain disabled until authorized;
- advertising remains disabled until authorized;
- perfume-transaction payment processing remains disabled;
- `PAYMENT_PROVIDER=disabled` until a separately authorized paid-platform-service activation;
- trusted image processing is enabled only after its acceptance gate;
- approved legal-content flags are true only after the actual published documents are approved;
- notification webhook secrets are unique per environment and satisfy the repository minimum entropy/length contract.

Do not copy exact production configuration from staging without independently verifying that the production gate authorizes each value.

---

# Production fail-closed readiness gate

Before an authorized production deployment, run the repository's current fail-closed production readiness command:

```bash
pnpm check:release -- --env-file=.env.production
```

The executable script is authoritative for the exact current machine-checkable release contract.

Do not hardcode a historical migration count or provider list into this runbook when those can evolve with the repository.

The gate should verify the current required combination of:

- production configuration;
- secret/config readiness;
- monetisation-disabled state where required;
- current forward-only migration expectations;
- legal-route/content requirements;
- exact release identity;
- fresh target/provider receipts.

It is expected to fail on an unprepared checkout/environment.

Do not weaken the release script merely to make the gate green.

---

# Release receipts

Where the current release contract requires hosted runtime/provider receipts, they must identify the exact release target and source.

As applicable, receipts should bind evidence to values such as:

- exact `RELEASE_COMMIT_SHA`;
- production application host;
- Supabase project ref;
- Cloudflare account;
- provider target;
- check timestamp.

Freshness requirements come from the current executable release contract.

Do not invent or manually edit a receipt merely to satisfy validation.

Configured SHA-256 values must be hashes of the exact evidence/receipt bytes expected by the current script.

---

## Hosted runtime inventory

Where required by the current repository contract, generate the hosted runtime inventory only after querying the intended target:

```bash
RELEASE_COMMIT_SHA="$(git rev-parse HEAD)" \
  node scripts/verify-hosted-runtime-inventory.mjs \
  --receipt-file=.release/hosted-runtime-inventory.json
```

Use the output paths/hashes expected by the current release script.

Do not treat a receipt generated for:

- another commit;
- another project;
- another Cloudflare account;
- another host;
- another provider configuration;

as reusable evidence.

Regenerate evidence when the current executable contract requires it.

---

## Provider attestation

Provider attestation must reflect the providers that are actually required by the current architecture and release contract.

Do not preserve obsolete provider requirements solely because an older receipt schema named them.

In particular, regular-user SMS/phone verification is not part of the current authentication model.

Do **not** re-enable Twilio/SMS merely to satisfy a stale historical provider-attestation field.

If the current executable release script still requires a deprecated provider such as `twilioSms`, treat that as a repository contract contradiction:

1. do not fake the provider evidence;
2. do not reintroduce the removed product requirement;
3. record/fix the release-contract inconsistency through the normal issue/risk process;
4. rerun the current release verification afterward.

Likewise, when new required providers are added, their acceptance belongs in the current executable receipt contract rather than only in prose.

---

# Migration discipline

Supabase migration history is forward-only.

Never edit an already applied migration to repair hosted state.

A failed or incomplete hosted change is repaired with a new forward-only migration when schema remediation is authorized.

Do not use remote/linked destructive shortcuts such as:

- `db reset`;
- migration-history rewriting;
- schema drops;
- blanket truncation;
- destructive migration repair;

unless an explicit protected recovery procedure authorizes that exact operation.

Local reset remains local-only.

---

# Migration and catalogue sequence

For an authorized hosted staging migration batch:

1. Inventory the intended staging target read-only according to `docs/STAGING-CREDENTIALS.md` and the active gate plan.
2. Stop on unexpected identity, region, migration history, objects, users, Storage, configuration or permissions where the gate defines them as stop conditions.
3. Run local database reset/tests when required and available.
4. Run:

```bash
pnpm db:staging:verify-target
```

5. Run the current dry-run command:

```bash
pnpm db:staging:push:dry-run
```

6. Review the exact pending forward-only history.
7. Apply only the migration history authorized by the current issue/gate:

```bash
pnpm db:staging:push
```

8. Re-inventory hosted migration/schema state.
9. Run the required RLS/security/concurrency evidence.
10. Seed synthetic staging data only when the active gate authorizes it.
11. Exercise hosted E2E only after its required providers and synthetic actors are ready.

Do not infer the current migration tip from an old number recorded in this document.

The repository's migration directory plus verified hosted migration history determine the current expected state.

---

## Immutable early migrations

Existing historical migrations remain immutable.

In particular, do not rewrite migrations `001` or `002`.

The same forward-only rule applies to every later migration once it has been applied to a shared hosted environment.

---

# Catalogue integrity

The known catalogue contract includes:

- 196 brands;
- 48 aliases;
- 335 editorial memberships;
- editorial membership split `80/80/80/80/15`.

Use the current catalogue validation tooling as the executable authority for these values.

A catalogue mismatch should be investigated rather than silently repaired during unrelated provider/release work.

Do not assume an old hosted inventory such as "0 users" or "0 Storage objects" remains a permanent expected baseline after staging has legitimately begun hosting synthetic actors/evidence.

Gate-specific inventories must define the state expected at that point in the sequence.

---

# Service-role handling

Service-role credentials are privileged secrets.

When an authorized operator command requires one:

- obtain it through the approved secret path;
- keep it out of logs and committed files;
- scope its use to the required command/session;
- clear it from the shell/session when practical after use;
- never expose it to browser code;
- never put it in a public webhook.

Use target-locking and provenance checks where the applicable operator supports them.

---

# Staging bootstrap and reconciliation

A basic local/pre-dispatch verification sequence may include:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:e2e
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
pnpm exec wrangler deploy --dry-run --env staging
```

This is not a universal execution workflow and does not replace the current GitHub issue, Superpowers process or named gate plan.

Run the checks appropriate to the current task.

Do not rerun or mutate completed gate evidence without cause.

---

## Initial/fresh Worker behavior

When provisioning a fresh staging Worker, an application may fail closed until required runtime configuration exists.

Do not interpret an expected fail-closed state as permission to leave the environment partially configured indefinitely.

Before treating a staging Worker as a known-good runtime, verify the applicable smoke contract, including where currently required:

- `/robots.txt` denies indexing;
- `/sitemap.xml` returns 404 during pre-launch;
- unauthenticated private routes fail closed;
- demo mode is off;
- monetisation remains disabled;
- required auth/provider behavior matches the active gate.

---

# Exact-source staging deployment

Staging must be attributable to the exact tested/approved source revision required by the active gate.

Before a deployment is accepted as evidence, distinguish:

```text
local SHA
remote main SHA
PR merge SHA
Worker source/version
active deployment
traffic assignment
```

When the active gate requires exact convergence, prove it explicitly.

Do not say "deployed main" merely because the branch name is `main`.

---

# Rollback

Before mutating staging Worker deployment state, capture or verify the current known-good rollback target according to the active deployment contract.

Do not hardcode a historical Worker version in this runbook as a permanent rollback target.

A rollback target can become stale after a later known-good release.

If smoke/security verification fails:

- restore the verified safe Worker deployment/version according to the current workflow;
- verify the required rollback smoke;
- keep the failed workflow/gate failed;
- investigate before another deployment attempt.

Application rollback does not authorize destructive database rollback.

Do not:

- reset hosted Supabase;
- rewrite migration history;
- reverse shared database state destructively

merely because a Worker deployment failed.

Hosted database changes remain forward-only.

---

# Notifications

Before relying on notifications for real-user operation, verify each supported required notification path in staging.

Acceptance should cover the applicable:

```text
database notification
→ webhook
→ Edge Function
→ delivery ledger
→ Resend
```

The notification function must preserve the architecture's privacy and delivery guarantees, including:

- recipient resolution through trusted server-side identity;
- generic/approved notification payloads;
- same-origin action URL validation;
- idempotency;
- durable delivery state;
- no unnecessary recipient-address persistence.

Provider failure must be observable through the approved logs/ledger without logging sensitive recipient data.

---

# Upload cleanup

Deploy `upload-cleanup` only to the intended environment.

Provide required secrets through protected provider configuration, including as currently applicable:

- `SUPABASE_URL`;
- privileged server credential;
- per-environment `UPLOAD_CLEANUP_SECRET`.

The cleanup secret must meet the repository's current minimum security requirements and must differ between environments.

If supported by the current function contract, configure the approved batch-size range.

Configure exactly the scheduler behavior required by the current repository/gate contract.

The scheduler must:

- authenticate through the approved secret header;
- never place the secret in the URL;
- use the expected HTTP method/path;
- retry only according to the approved retry policy;
- preserve idempotent/lease-safe overlapping execution;
- expose failures for monitoring without logging private object paths.

If retry semantics remain an unresolved product/operator decision in the current gate, do not invent them in this runbook; use the applicable Human Gate or approved gate plan.

---

# Registration ramp

Registration uses the approved ordinary email/password product model.

The beta go-to-market may still ramp user exposure operationally.

Exercise internal/synthetic accounts first.

When the applicable:

- error rate;
- abuse/moderation queue;
- email delivery;
- provider health;
- security evidence

remain acceptable, expand the beta cohort gradually.

A reasonable early operational sequence may use groups such as:

```text
internal/synthetic
→ approximately 10 real beta users
→ approximately 30–50 real beta users
→ later authorized expansion
```

These are rollout cohorts, not invite-only authentication requirements.

Stop or pause expansion for severe conditions such as:

- P0/P1 correctness/security issue;
- cross-account data access;
- unauthorized moderation access;
- lost finalized uploads/evidence;
- failed required restore capability;
- unexpected billing/monetisation path;
- material privacy leak;
- other launch-gate blocker.

---

# Production deployment boundary

Production deployment is not automatically authorized by completion of staging setup.

Before production activation, the applicable repository gates must cover at least the required:

- provider acceptance;
- backup/restore proof;
- domain/HTTPS readiness;
- legal/privacy approval;
- security acceptance;
- external-user readiness;
- monitoring/incident response;
- production configuration;
- exact release evidence.

Production operations are protected.

An agent may prepare safe local/R1/R2 implementation work where repository policy allows, but must not cross the R3 production boundary without explicit owner authorization through the applicable Human Gate.

This includes, as applicable:

- creating or changing production providers;
- production database mutations;
- production Auth changes;
- production Worker deployment;
- production DNS/domain changes;
- production secrets;
- enabling monetisation;
- destructive provider actions.

---

# Agent and skill interaction

This runbook defines operational constraints.

It does not create another engineering workflow.

Use:

`docs/agents/SKILL-ROUTER.md`

for skill routing.

The relationship remains:

```text
repository / issue / gate authority
        ↓
Superpowers primary process
        ↓
Matt Pocock engineering-depth reasoning when useful
        ↓
ECC / platform specialist when useful
        ↓
repository-defined verification
```

For this runbook, ECC/platform expertise may be particularly useful for:

- Supabase;
- Cloudflare;
- backend/security;
- E2E/Playwright;
- provider documentation;
- release verification.

Matt Pocock skills may help reason about architecture, failure states and implementation boundaries.

Neither may:

- bypass target locks;
- change production authorization;
- weaken security invariants;
- replace the active gate plan;
- establish a parallel deployment workflow.

Do not run competing planning, debugging, TDD or completion loops.

---

# Contradiction handling

Operational documentation can become stale faster than architecture/business policy.

If this file conflicts with:

- current repository code;
- executable release scripts;
- `docs/PROJECT-STATUS.md`;
- a newer approved gate plan;
- a durable owner decision;

do not silently choose whichever version makes execution easiest.

Determine whether the discrepancy is:

- stale documentation;
- stale code;
- incomplete migration;
- temporary provider state;
- an intentional gate-specific exception;
- a real unresolved decision.

Then update the appropriate durable authority through the normal issue/risk process.

Never restore an obsolete product requirement merely because an old production checklist still mentions it.

---

# Core production invariant

```text
Local, staging and production stay isolated.
Hosted targets are verified before mutation.
Named gate scope limits what may be changed.
Database history remains forward-only.
Secrets remain outside source control.
Staging evidence is tied to exact source and target.
Rollback restores application runtime without destructively rewriting the database.
Public email/password signup does not imply invite-only beta.
Removed SMS requirements must not be resurrected by stale release receipts.
Monetisation remains off until its business/legal/production gates pass.
Production mutations remain protected R3 actions.
Skills assist execution but never grant deployment authority.
```