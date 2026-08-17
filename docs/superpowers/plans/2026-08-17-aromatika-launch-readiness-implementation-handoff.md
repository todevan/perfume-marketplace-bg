# Aromatika 2026-08-17 Launch Readiness — Implementation Handoff

**Status:** Owner-approved design package ready for implementation  
**Supersedes for current work:** the 2026-08-15 Agent OS design/plans where they conflict with this package.

## Owner's active local workspace

```text
C:\Users\Admin\Documents\Сайт парфюми.worktrees\current-main-20260813\
```

The owner's explicit current instruction is highest authority.

The local workspace is the active working authority for intentional current work.

GitHub `main` is the last reviewed and synchronized shared baseline.

Never destroy unknown local work merely to make the PC match GitHub.

---

## Read first

1. `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`
2. this handoff
3. the plan currently being executed
4. current `AGENTS.md` / `docs/PROJECT-STATUS.md` after they are migrated

Do not scan all historical August 15 plans at startup.

---

## Implementation order

Execute in this exact order:

1. `2026-08-17-aromatika-agent-os-local-first-instructions-plan.md`
2. `2026-08-17-aromatika-repository-truth-launch-readiness-plan.md`
3. `2026-08-17-aromatika-github-safety-launch-readiness-queue-plan.md`

After those three plans are completed, work moves to evidence-backed product issues in the Launch Readiness Queue.

Do **not** execute the August 15 plans verbatim.

---

## Required execution mode

Recommended:

> Superpowers `subagent-driven-development`

Why:
- each meaningful task gets a fresh implementation context;
- task-level review occurs between changes;
- cheap workers can perform bounded documentation/mechanical work;
- strong models are reserved for authority/security/architecture/payment-entitlement decisions;
- specialists join only when triggered;
- the owner does not need to orchestrate agents.

If subagent-driven execution is unavailable, use Superpowers `executing-plans` with review checkpoints.

At execution time, use the Superpowers worktree skill before creating new isolated worktrees.

---

## Strategic destination

Current objective:

> **Aromatika Launch Readiness**

Not:
- closed beta;
- public beta;
- Beta 30;
- invite cohort;
- waitlist.

Normal user access:

```text
email/password registration
-> email confirmation
-> onboarding (username + city/location + Terms/Marketplace Rules)
-> full marketplace access
```

No normal-user:
- invitation;
- waitlist;
- manual approval;
- phone verification;
- SMS OTP.

---

## Current transaction truth

```text
listing
-> offer
-> seller accepts
-> private chat
-> seller completes
   OR
-> buyer/seller cancels with required reason
```

Completed deal unlocks the applicable review flow.

Cancelled deal does not unlock reviews.

Prior mutual/both-side completion language is superseded.

---

## Current launch monetization truth

```text
10 free simultaneously active qualifying listings
```

Qualifying:
- For Sale
- For Exchange
- Sale or Exchange

Not counted:
- Wanted / Looking For
- sold
- removed/cancelled
- expired

Then:

```text
11th+ qualifying active listing
-> paid individually
-> valid 30 days
```

Also at launch:

```text
paid time-limited Boost / Featured promotion
```

Aromatika does not take commission from the perfume sale.

Perfume payment/delivery remain buyer-to-seller.

Exact service-payment provider and launch prices remain owner decisions.

Verified Merchants participate from launch under the same base listing model; merchant verification cannot be purchased and no merchant subscription is required at launch.

Launch geography is Bulgaria.

No courier API integration is required for launch.

---

## Agent/owner boundary

### Agents handle autonomously
- branches/worktrees;
- implementation;
- routine Git;
- tests;
- independent code review;
- security review;
- CI;
- safe R0/R1/R2 merges;
- issue state;
- documentation/status reconciliation;
- safe continuation to the next authorized issue.

### Owner decides/acts on
- new product choices with multiple valid outcomes;
- pricing;
- payment-provider commercial selection;
- legal/privacy/business commitments;
- meaningful spending;
- destructive production actions;
- protected provider/account actions;
- final public launch.

The owner is not a code-review gate.

---

## Required task handoff

Every task ends with:

```text
What changed:
<plain-language result>

Your action:
Your action: none.
OR
Your action now:
<exact sequential steps>

Sync status:
Synchronized | Local ahead | Remote ahead | Diverged

Next autonomous steps:
<what happens next without asking>

Stop condition:
<what blocks safe continuation>
```

Do not end with raw logs, a commit SHA, or “done”.

---

## Local/GitHub synchronization rule

Before substantial work:

```powershell
git status --short
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/main
```

Classify:
- `Synchronized`
- `Local ahead`
- `Remote ahead`
- `Diverged`

Preserve unknown local work.

Do not use destructive reset/clean operations merely to make the workspace match GitHub.

---

## GitHub safety baseline

Re-verify at execution time.

Known prior real CI evidence showed `quality` jobs/checks:
- `app`
- `database`

Do not create a dummy PR merely to discover check names if a real recent PR run already provides them.

Current branch protection must be freshly verified with sufficient permission. A 403 means `not verifiable with current permission`, not automatically `unprotected`.

---

## Product work after governance migration

After the three plans complete, agents inventory current code/tests and create only evidence-backed Launch Readiness issues.

Current Golden Path target:

```text
register
-> email confirmation
-> onboarding
-> listing
-> upload/publish
-> discover
-> seller/trust view
-> offer
-> accept
-> private chat
-> seller completes
-> review
```

Cancellation:

```text
accepted deal
-> either party cancels
-> reason stored
-> review remains locked
```

Safety:

```text
report/block
-> moderation
-> cross-user authorization denial
```

Monetization:

```text
10 qualifying active listings
-> attempt 11th
-> trusted service-payment confirmation
-> 30-day paid entitlement
-> publish
```

---

## Stop rules

Stop rather than guess when:
- local/remote state cannot be reconciled without risking unknown work;
- required GitHub permission is missing;
- security cannot be proven;
- CI required by policy does not pass;
- a provider/account/legal/spending/final-launch action is R3;
- hosted state is not freshly verifiable and the task depends on it.

Do not ask the owner to debug technical failures.

---

## Completion of the migration package

The Agent OS / repository-truth / GitHub-safety migration is complete only when:

- current strategic authority is `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`;
- `MASTER-PLAN.md` is only a roadmap/index;
- active docs no longer use beta/invite/mutual-completion/monetization-disablement rules;
- local-first authority is encoded;
- `Sync status` is mandatory;
- R2 uses independent technical/security review and deterministic evidence;
- GitHub `main` protection is configured or a precise account/provider blocker is documented;
- a small evidence-backed Launch Readiness Queue exists;
- one R1 and one R2 autonomous workflow have been exercised;
- the local owner workspace is reconciled with the reviewed GitHub baseline without destroying unknown work.

After that, the agents continue from the highest-priority unblocked Launch Readiness issue.
