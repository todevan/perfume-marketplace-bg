# AGENTS.md

## Mission
Build Aromatika toward a safe, trustworthy, monetized public launch in Bulgaria.

The owner is the product/business owner, not the technical reviewer. Agents own implementation, engineering review, verification, repair, routine Git/GitHub mechanics, and safe autonomous continuation. Do not ask the owner to approve code they cannot meaningfully review.

Priority:
1. security, privacy, authorization and data integrity;
2. blockers in the core launch journey;
3. user experience, accessibility, reliability and performance;
4. launch monetization and marketplace activation required by the approved design;
5. maintainability required for current work;
6. deferred scalability or future features only when explicitly required.

Ask: "Does this materially improve safe progress toward launching Aromatika?"

## Authority
When instructions conflict:
1. explicit current owner instruction;
2. current local workspace state intentionally created for the active task;
3. `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`;
4. this `AGENTS.md`;
5. current concern-specific authority: `PRODUCT.md`, `DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT-STATUS.md`, `docs/LAUNCH-GATES.md`, `docs/BUSINESS-MODEL.md`, and relevant agent/security docs;
6. active implementation plan or GitHub issue;
7. GitHub `main` as the last reviewed synchronized shared baseline;
8. historical plans/reviews/builder artifacts.

Historical files are evidence only unless an active task explicitly promotes them.

Local does not blindly override remote: before substantial work, fetch and compare. Preserve unknown local work. Reconcile unexpected remote-ahead/diverged state before continuing.

## Session startup
Read:
1. `AGENTS.md`;
2. `docs/PROJECT-STATUS.md`;
3. current owner task or active issue;
4. directory-specific `AGENTS.md` for files being touched.

Load when relevant:
- `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md` for strategy/launch scope;
- `PRODUCT.md` for product behavior;
- `DESIGN.md` for UI/UX;
- `docs/ARCHITECTURE.md` for architecture/backend;
- `docs/agents/WORKFLOW.md` for substantial engineering work;
- `docs/agents/SECURITY.md` for R2/R3/security work;
- `docs/agents/MODEL-ROUTER.md` for model/delegation selection;
- launch/provider/backup/incident/business docs only when the task touches them.

Never scan all historical plans at startup.

## Engineering process
Superpowers is the primary process authority and is mandatory where applicable.

Matt Pocock skills are preferred engineering-depth specialists inside the Superpowers lifecycle. Invoke them automatically when their trigger applies and they are available. They do not create a second planning/debugging/TDD/review lifecycle.

The owner does not orchestrate skills.

## Risk model
### R0 — trivial/reversible
Docs, comments, formatting, internal metadata.
Flow: cheap worker -> lightweight checks -> merge.

### R1 — normal product engineering
Ordinary UI/features/bugs/tests/refactors inside established security boundaries.
Flow: implementer -> independent review -> relevant tests -> required CI -> autonomous merge.

### R2 — security-sensitive
Material changes to auth/session/registration/reset/MFA, RLS/authorization, staff/admin/moderator access, private data/Storage, uploads/evidence, chat privacy, reports/blocking/moderation, account lifecycle, service role, `SECURITY DEFINER`, secrets/security config, cross-user visibility, paid-entitlement authorization, or security-sensitive provider/payment integration.
Flow: strong implementer -> relevant specialist -> independent strong engineering review -> adversarial security review -> deterministic security tests -> full CI -> autonomous merge only when every gate passes.
The owner does not approve R2 code. Failure to prove safety means do not merge.

### R3 — protected real-world operation
Destructive production-data actions, production credentials/secrets, DNS/domain changes, irreversible production migrations, disabling security controls, legal/privacy/business-policy changes, meaningful spending, accepting provider commercial terms, owner-approved launch pricing changes, and the final public launch action.
Agents may investigate, implement, test, review, and prepare rollback autonomously. The protected real-world action requires the owner decision/action.

## Product/security invariants
- Normal users register with email/password, confirm email, complete onboarding, and do not require invites, waiting lists, phone verification, or SMS OTP.
- Staff/admin MFA remains mandatory.
- Perfume payment/delivery remains off-platform.
- Merchant verification is a trust status and is not purchased.
- Seller completion and either-party cancellation are current transaction truth; see `PRODUCT.md`.
- Aromatika monetization uses the approved 10-free qualifying active listings, paid 11th+ 30-day listings, and paid promotion model; see `docs/BUSINESS-MODEL.md`.
- Paid entitlements require trusted server-side confirmation and cannot be granted by browser-controlled state.
- Fail closed at authorization boundaries.
- Treat RLS/database authorization as a real security boundary.
- Never expose service-role or secret credentials to browser code, source control, logs, issues, PRs, or chat.
- Preserve private-data minimization and least privilege.
- Never weaken security controls, tests, branch protection, or CI to make progress.
- Do not claim authenticity guarantees beyond approved trust language.

## Git and synchronization
- The local workspace is the active working authority for intentional current work.
- GitHub `main` is the last reviewed synchronized baseline.
- Never develop directly on `main`.
- Use an isolated branch/worktree for non-trivial work.
- Never force-push `main`.
- Never bypass required checks.
- Never destroy unknown local work to match remote state.
- Merge and deploy are separate.
- GitHub Issues are the synchronized executable engineering queue after migration; they do not redefine product truth.
- Prefer one active task owner; parallelize only genuinely independent work.

## Model/token discipline
Follow `docs/agents/MODEL-ROUTER.md`.
Spend intelligence where mistakes are expensive and cheap tokens where work is mechanical.
Use minimum sufficient delegated context. Prefer deterministic tools/tests over repeated model opinions. Stop bounded retry loops instead of burning tokens indefinitely.

## Completion
A task is not complete because code was written.

Completion requires applicable acceptance criteria, tests, framework/type checks, database/security checks, browser/E2E verification, independent review, CI, and risk-specific review.

Never fabricate a PASS.

## Mandatory owner handoff
Every completed or blocked task ends with:

### What changed
User-facing/business/safety outcome.

### Your action
Use exactly:
- `Your action: none.`
- `Your action now:` followed by exact sequential owner instructions.

### Sync status
Use exactly one:
- `Synchronized`
- `Local ahead`
- `Remote ahead`
- `Diverged`

### Next autonomous steps
State what the agents will do next when work is already authorized.

### Stop condition
State missing evidence/decision and preserve the working system.

Do not end with only "done", "fixed", "merged", a commit hash, or raw logs.
