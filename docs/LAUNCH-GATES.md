# Launch Gates

## Purpose

## Purpose and authority

This document defines readiness conditions for progressively broader marketplace exposure. It does not define the executable engineering queue, the implementation workflow, detailed reconciliation steps such as A7/A8/A9, or authority to mutate staging or production.

Keep these concepts separate:

```text
readiness condition
≠ named-gate execution scope
≠ mutation authority
```

Applicable approved gate plans define their narrower scope and evidence. `AGENTS.md`, `docs/agents/AUTONOMY.md`, and `docs/agents/HUMAN-GATES.md` define mutation authority. Passing a launch gate does not itself authorize a protected provider, production, legal, or commercial action.

GitHub Issues remain the executable queue. Superpowers owns the primary engineering process; other skills contribute only their documented engineering-depth or specialist role.

## Free pre-launch beta
This document defines product, legal, operational and commercial conditions that must be satisfied before progressively broader marketplace exposure.

It is an engineering and release-readiness checklist.

- public email/password registration follows the durable owner decision in `docs/MASTER-PLAN.md`; no regular-user invitation or phone-verification gate is required;
- any legacy invitation mechanism is limited to explicitly retained operator/bootstrap behavior;
- all platform billing flags remain off;
- fake/demo offers are clearly marked or real beta users accept the beta terms;
- reports, account blocking and emergency listing removal are operational;
- backups, error monitoring and an incident contact exist.
It is not legal, accounting or tax advice.

It does not define:

- the autonomous engineering queue;
- the implementation workflow;
- the skill-routing workflow;
- detailed reconciliation sub-gates such as A7/A8/A9;
- authority to mutate staging or production.

For those concerns, use the applicable repository authorities:

- `AGENTS.md`
- `docs/MASTER-PLAN.md`
- `docs/PROJECT-STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/agents/AUTONOMY.md`
- `docs/agents/EXECUTION-LOOP.md`
- `docs/agents/HUMAN-GATES.md`
- `docs/agents/issue-tracker.md`
- applicable approved plans under `docs/superpowers/plans/`

A launch gate defines **what must be true** before exposure advances.

Passing a launch gate does not by itself authorize a protected provider or production mutation.

---

# Gate model

The intended progression is:

- Counterfeit, stolen-image, harassment, spam and product-safety report categories are staffed with an SLA.
- Safety Gate contact and recall/takedown procedure are documented.
- Merchant verification is free and cannot be purchased through VIP.
- Sponsored positions are labelled, capped at 10% of a feed and never alter the organic rows beneath them.
- Retention jobs and deletion/export requests are tested before real personal data is accepted.

## Risk, Human Gates, and completion evidence

Launch requirements do not override repository autonomy policy. Ordinary implementation proceeds autonomously when permitted; R2 engineering stops at H3 before merge; legal/privacy/business decisions use their applicable Human Gate; and protected provider, production, destructive, or commercial activation remains an R3/owner-authorized boundary.

A gate is complete only when every required acceptance condition is proven. Do not collapse these distinct claims:
```text
development / staging
        ↓
free pre-launch beta
        ↓
public marketplace
        ↓
paid platform services
        ↓
broader production operation
```

Some engineering reconciliation plans may divide one of these stages into narrower named gates.

For example:

```text
Gate 3
  → A7
  → A8
  → A9
  → later explicitly defined steps
```

Those detailed gate plans are strict execution boundaries when active.

Do not treat this broad launch checklist as permission to skip, merge or reorder their required evidence.

---

# General release principles

Before advancing exposure:

- required acceptance conditions must be proven rather than assumed;
- temporary staging/provider state must not be mistaken for durable product policy;
- current hosted behavior must be verified where local evidence cannot prove it;
- unresolved legal/business decisions must use the applicable Human Gate;
- production or other protected mutations must follow R3/owner-authorized boundaries where applicable;
- a successful implementation or green CI run is not sufficient evidence for a gate that explicitly requires hosted or operational proof.

GitHub Issues remain the executable engineering queue.

Installed skills may help achieve or verify launch requirements, but do not redefine them.

---

# Free pre-launch beta gate

A free pre-launch beta may operate only when the minimum trust, safety and operational controls required for real users are working.

Public email/password registration is permitted according to the durable owner decision recorded in `docs/MASTER-PLAN.md`.

The beta gate does **not** require reverting registration to invite-only.

Legacy invitation mechanisms may remain where explicitly required for operator/bootstrap behavior, but they are not the normal user-admission model.

Before real beta users are accepted:

- all platform billing and monetisation flags remain off;
- payment processing for perfume transactions remains off-platform;
- fake/demo activity is clearly distinguishable from real activity;
- real beta users are presented with the applicable beta terms and legal onboarding requirements;
- reports are operational;
- account blocking or the currently approved equivalent safety control is operational before relying on it for abuse protection;
- emergency listing removal is operational;
- required moderation access remains role-bound, case-bound and audited;
- backups appropriate to the current beta risk exist;
- error monitoring appropriate to the current environment exists;
- an incident contact/process exists;
- required authentication, membership, RLS and staff-MFA boundaries have verified acceptance evidence.

Where a particular safety behavior such as blocking semantics remains an unresolved owner decision, use the applicable Human Gate rather than silently choosing a behavior merely to satisfy this checklist.

A free beta does not authorize:

- platform payments;
- paid listing entitlements;
- boosts;
- merchant subscriptions;
- ads;
- production monetisation.

---

# Hosted staging readiness

Before staging is treated as representative evidence for broader beta/release decisions, required provider integrations must be configured and verified according to the active reconciliation plan.

Depending on the active gate, this may include:

- Supabase Auth;
- PostgreSQL migrations and RLS;
- Storage;
- Realtime;
- Cloudflare Worker deployment;
- Turnstile;
- Cloudflare Images;
- Resend;
- Database Webhooks;
- Edge Functions;
- schedulers;
- required staging secrets;
- synthetic authenticated actors;
- staff/moderator AAL2 behavior.

Hosted acceptance must distinguish:

```text
local implementation
≠
merged source
≠
deployed source
≠
correct provider configuration
≠
complete hosted acceptance
```

When an active reconciliation plan requires exact SHA, target-locking, actor provenance or provider receipts, those requirements are mandatory for that gate.

Do not perform unrelated provider mutations merely because they would make a hosted test easier.

---

# Public marketplace gate

Do not treat completion of engineering beta work as sufficient legal clearance for unrestricted public marketplace operation.

Before public marketplace launch, obtain appropriate Bulgarian professional legal review for the project's actual marketplace model.

The review should resolve the repository's outstanding legal and policy questions concerning at least:

- DSA hosting/online-platform duties;
- notice-and-action procedures;
- reasoned moderation decisions;
- moderation appeals;
- trader/private-seller classification;
- required public merchant disclosures;
- GPSR / Safety Gate obligations and processes;
- perfume/cosmetic product information;
- DAC7 applicability to the platform's actual offer, messaging, deal-confirmation and intervention model;
- testers;
- official samples;
- opened perfume;
- parallel imports;
- counterfeit handling;
- marketplace Terms;
- Privacy documentation;
- Marketplace Rules;
- Safety Guide;
- appeal processes;
- data retention;
- deletion/export behavior.

These are review topics, not conclusions that an engineering agent should resolve independently.

Use the applicable legal/privacy/business Human Gate whenever correctness depends on owner policy or professional advice.

---

## DAC7-sensitive launch boundary

If approved professional advice determines that DAC7 applies to the platform's actual operating model, public launch must not proceed until the required seller identity, tax/reporting and transaction-data obligations identified by that advice are implemented and verified.

If approved professional advice determines that structured offer acceptance creates legal consequences requiring a different marketplace model, the affected flow must remain disabled or constrained until the product, legal documentation and implementation are reconciled.

An AI agent must not independently determine DAC7 applicability or the legal effect of an offer.

---

# Legal and privacy readiness

Before unrestricted real-user operation, the applicable legal/privacy phase must close its repository-defined requirements.

At minimum, ensure that no known placeholder or intentionally stale pre-launch legal text is being presented as final approved content.

Required privacy behavior must be implemented and tested according to approved policy, including the applicable:

- data access/export;
- account deletion;
- anonymisation;
- retention;
- moderation/legal-hold exceptions;
- contact channels.

Do not invent retention periods, legal bases or deletion exceptions.

Those require the appropriate owner/professional decision when not already defined.

---

# Paid-service gate

The marketplace's underlying perfume transaction remains off-platform.

No payment provider is used to process the perfume purchase, sale or exchange itself unless the product model is explicitly changed through the required business/legal process.

Before enabling any platform-paid feature such as:

- the planned €1.99 listing entitlement;
- boosts;
- merchant subscriptions;
- advertising or sponsored commercial features;

the required business and payment-readiness conditions must be satisfied.

These include the approved business prerequisites for:

- a Bulgarian operating entity;
- business banking;
- accounting;
- VAT-inclusive pricing;
- invoices or required fiscal documentation;
- refunds;
- withdrawal rights where applicable;
- chargebacks;
- approved customer-facing payment terms.

Do not let an engineering agent infer that these business/legal prerequisites are satisfied from the existence of payment code.

---

## Payment-provider technical acceptance

Before enabling paid platform services, the selected primary payment-provider integration must pass its repository-defined technical acceptance.

For the currently planned provider path, acceptance includes verification of the relevant:

- signed callback/webhook behavior;
- exact required acknowledgement;
- duplicate-event handling;
- idempotency;
- failed/rolled-back payment handling;
- refund handling;
- production Cloudflare-path behavior where required by the release plan.

A fallback provider may be tested as contingency infrastructure but must remain disabled unless activation is separately authorized.

Provider scaffolding is not authorization to enable billing.

Real paid-service activation is a protected business/production boundary and must use the applicable Human Gate and risk rules.

---

# Commercial activation thresholds

The planned listing-fee feature must not activate merely because payment infrastructure is technically ready.

Under the current business model, activation requires three consecutive months meeting all of the following:

- at least 500 quality active listings;
- at least 150 active sellers;
- at least 35% of new listings receiving a qualified enquiry within 30 days.

After activation, a decline greater than 15% in new listings triggers review of the fee.

These thresholds are business rules rather than engineering heuristics.

Do not alter, reinterpret or bypass them without an explicit owner business decision.

---

# Operational gate

Before broader real-user operation, the platform must have an operational trust-and-safety model appropriate to its exposure.

The applicable requirements include:

- counterfeit reports can be handled;
- stolen-image reports can be handled;
- harassment reports can be handled;
- spam reports can be handled;
- product-safety reports can be handled;
- moderation has an approved service-level expectation appropriate to the launch stage;
- a Safety Gate contact/process exists where required;
- recall/takedown handling is documented;
- emergency removal is operational;
- merchant verification remains independent of paid/VIP status;
- retention jobs are tested;
- deletion/export workflows are tested before relying on them for real personal-data handling;
- backup and restore behavior is proven to the level required by the current release stage;
- monitoring and alerting are operational;
- incident response has a known owner/contact path.

Operational readiness requires real processes, not only UI controls.

---

# Merchant integrity

Merchant verification must not be purchasable through a paid tier, VIP feature, boost or other monetisation mechanism.

Commercial status must not substitute for verification.

Any future change to merchant-verification policy is a product/business decision and must use the applicable Human Gate.

---

# Sponsored-content integrity

If sponsored placement is introduced in a future authorized monetisation phase:

- sponsored positions must be clearly labelled;
- sponsored positions must remain capped at 10% of a feed;
- sponsored insertion must not silently change the ranking/order of the organic rows beneath them.

Advertising remains deferred until explicitly authorized.

The existence of UI or provider scaffolding does not enable it.

---

# Deferred features

The following remain disabled until their own authorized phases/gates:

- perfume checkout;
- platform processing of perfume payments;
- delivery integration;
- chat attachments;
- decants/splits/attar formats;
- boosts;
- subscriptions;
- ads;
- paid listing entitlements;
- other platform monetisation.

Do not activate a deferred feature incidentally while satisfying another launch gate.

---

# Risk and Human Gate interaction

Launch requirements do not override repository autonomy policy.

Use the authoritative R0–R3 and H1–H6 definitions under `docs/agents/`.

Typical boundaries include:

```text
ordinary implementation
→ autonomous when policy permits

high-risk engineering
→ required review/verification
→ H3 before merge when R2

legal/privacy/business decision
→ applicable Human Gate

protected production/provider/business activation
→ R3 / owner-authorized boundary
```

A specialist skill's recommendation does not constitute owner approval.

Passing automated tests does not satisfy a Human Gate.

---

# Skill interaction

Skill routing is defined in:

`docs/agents/SKILL-ROUTER.md`

For launch-related work, the normal relationship remains:

```text
repository launch requirement
        ↓
Superpowers primary process
        ↓
Matt Pocock engineering-depth reasoning when useful
        ↓
ECC / platform specialist where useful
        ↓
repository-defined verification
```

Examples of useful specialist contributions include:

- ECC security review;
- backend/database analysis;
- Playwright/E2E evidence;
- Supabase-specific verification;
- Cloudflare-specific verification;
- documentation lookup;
- independent engineering review.

Do not introduce a second launch workflow merely because a specialist skill has its own preferred methodology.

---

# Gate completion

A gate may be marked complete only when all of its required acceptance conditions are satisfied.

Do not collapse these concepts:

```text
implemented
tested locally
merged
deployed
configured
verified in the target environment
verified in staging
approved where required
launch-ready
```

If one condition remains unresolved, report that exact boundary. A previously completed gate is reopened only when new evidence proves one of its required conditions was false, regressed, or is no longer valid.

Skill routing remains defined by `docs/agents/SKILL-ROUTER.md`. Skills may help implement or verify launch conditions; they cannot redefine policy, waive a Human Gate, broaden named-gate scope, or authorize a provider/production mutation.
Each claim requires the evidence appropriate to that claim.

If one required condition remains unresolved, report the exact remaining boundary rather than describing the whole gate as complete.

---

# Gate regression

A previously completed gate should not be reopened merely because later work discovers an unrelated problem.

Reopen or invalidate earlier gate evidence only when new verified evidence shows that a condition required for that gate was actually false, regressed or no longer valid.

Otherwise:

- preserve the prior evidence;
- record the new issue separately;
- continue according to dependency and scope rules.

This prevents later reconciliation work from repeatedly destroying or rerunning valid earlier evidence without cause.

---

# Core launch invariant

```text
Launch gates define required readiness conditions.
Named reconciliation plans define narrower execution boundaries.
GitHub Issues define executable engineering work.
Superpowers governs the primary process.
Matt Pocock skills deepen engineering reasoning.
ECC/platform skills provide specialist evidence.
Human Gates resolve decisions outside autonomous authority.
Production and commercial activation require explicit authorization.
Evidence, not implementation confidence, determines readiness.
```
