# Aromatika Launch Readiness Design

**Status:** Owner-approved launch design; agent execution routes through Agent System V2
**Date:** 2026-08-17  
**Supersedes:** `2026-08-15-agent-os-v2-design.md` for current strategy  

---

## 1. Purpose

Aromatika is being prepared for a real public launch as a Bulgarian perfume marketplace.

The objective is no longer “open beta” or an invite-controlled rollout. The goal is:

> **Aromatika Launch Readiness**

The engineering system must help Aromatika reach a safe, trustworthy, monetized launch without requiring the owner to understand or operate code review, Git internals, CI, database authorization, agent orchestration, or routine deployment mechanics.

The owner is the product/business owner, not the technical reviewer.

The system must:

1. protect user data and marketplace trust;
2. move steadily toward a real launch;
3. preserve a high-quality, mobile-first marketplace experience;
4. keep the owner out of unnecessary engineering mechanics;
5. use stronger models only where the risk or complexity justifies them;
6. let agents review other agents rather than using owner approval as a substitute for engineering review;
7. keep repository instructions concise and non-duplicative;
8. preserve a clear local-first working authority model;
9. keep GitHub synchronized as the reviewed shared baseline;
10. always tell the owner what changed, whether action is required, what happens next, and whether local/GitHub state is synchronized.

No AI system can guarantee that a breach will never occur. Security therefore uses defense in depth, least privilege, fail-closed authorization, independent review, hostile-client testing, deterministic evidence, and conservative handling of uncertainty.

---

## 2. Owner experience

The owner should be able to give instructions such as:

- `Continue Aromatika.`
- `Fix the launch blockers.`
- `The listing page feels bad on mobile.`
- `Make registration easier.`
- `Prepare the next launch step.`

The owner must not normally be asked to:

- review code diffs or SQL;
- select branches or Git merge strategies;
- decide which CI job or test to run;
- resolve routine Git conflicts;
- choose between engineering methodologies;
- orchestrate Superpowers, Matt Pocock, testing, security, or platform skills;
- approve reversible technical choices already determined by repository patterns, product rules, tests, or architecture;
- approve security-sensitive code merely because a “human gate” exists.

The owner remains responsible for:

- product behavior when multiple valid experiences exist;
- business-model and pricing decisions;
- legal/privacy/business policy;
- meaningful spending;
- irreversible or destructive production actions;
- protected provider/account actions;
- the final business decision to launch Aromatika.

The relationship is:

> **The owner decides what Aromatika should be. The agents decide how to engineer it safely.**

---

## 3. Mandatory owner handoff

Every completed or blocked task must end with:

### What changed
Explain the user-facing, business, or safety outcome.

### Your action
Use exactly one of:

- `Your action: none.`
- `Your action now:` followed by exact sequential instructions for a real unavoidable owner action.

When owner action is required, instructions must identify:

1. the exact provider/service;
2. the exact project/environment;
3. the exact page or setting;
4. what to change;
5. what not to touch;
6. the expected result;
7. how the agent will verify it afterward.

### Sync status
Use one of:

- `Synchronized` — approved local state is present on GitHub `main`.
- `Local ahead` — approved work exists locally but has not reached GitHub yet.
- `Remote ahead` — GitHub contains newer work that must be reconciled locally.
- `Diverged` — local and GitHub both contain different work and must be reconciled before continuing.

### Next autonomous steps
State what the agents will do next without asking permission when the next work is already authorized.

### Stop condition
If the agent cannot safely continue, state why and what evidence or owner decision is missing.

The owner should never be left wondering what to do next or whether work exists only on the PC.

---

## 4. Authority model

The one current authority ladder is defined by the root [`AGENTS.md`](../AGENTS.md)
router and [`docs/agents/reference/AUTHORITY.md`](agents/reference/AUTHORITY.md). This
document owns launch strategy and product direction only; it does not create another
engineering queue or execution ladder.

Local and remote state must be reconciled before substantial work. Unknown local
changes are preserved, while live GitHub Issues and Git provide queue and integration
truth.

---

## 5. Current document authority

### `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`
Strategic launch design and top-level direction.

### `PRODUCT.md`
Product behavior and marketplace rules.

### `DESIGN.md`
Sole visual/UX authority.

### `docs/ARCHITECTURE.md`
Technical architecture and runtime boundaries.

### `docs/PROJECT-STATUS.md`
One concise current operational snapshot only.

### `docs/LAUNCH-GATES.md`
Evidence required before launch.

### `docs/BUSINESS-MODEL.md`
Current monetization rules, prices/settings references, and commercial boundaries.

### `docs/agents/WORKFLOW.md`
Compatibility index for the six Agent System V2 stages.

### `docs/agents/SECURITY.md`
Security-sensitive engineering and protected-action rules.

Agent lifecycle, tool routing, and cost discipline are canonical under
[`docs/agents/CONTEXT.md`](agents/CONTEXT.md) and its stage/reference links.

### `MASTER-PLAN.md`
No longer a strategic authority. It becomes a small roadmap/index pointing to the current authoritative documents.

Historical August 15 Agent OS files remain available as evidence but must be clearly marked superseded/historical after this design is implemented.

---

## 6. Local-first engineering workflow

The canonical lifecycle is the six-stage map in
[`docs/agents/CONTEXT.md`](agents/CONTEXT.md): orient, shape, implement, verify,
conditional hosted proof, and complete. Candidate formation happens after deterministic
pre-freeze work; final risk-appropriate review, exact-SHA CI, merge, and cleanup follow.

### Local/remote reconciliation

At the start of substantial work:

1. inspect local changes;
2. fetch GitHub;
3. compare local and remote;
4. determine whether differences are intentional;
5. preserve unknown work;
6. reconcile remote-ahead or diverged states before proceeding.

The agent must not use destructive commands such as a hard reset merely to make the workspace look like GitHub unless the exact impact is understood and intentionally authorized.

GitHub `main` is the shared verified baseline, not the origin of newer local product decisions.

---

## 7. Engineering authority

The root agent router and selected stage contract own the execution lifecycle. For
shaping, Matt Pocock skills are primary; an already approved executable issue normally
serves as the specification and does not need a duplicate plan.

### Matt Pocock skills
Matt skills shape ambiguous or multi-session work before tactical implementation.

Typical uses:

- diagnosing difficult bugs;
- domain/state modeling;
- codebase/interface design;
- independent code review;
- exact owner/provider wizards;
- agent-facing instruction writing.

They do not create a second queue or duplicate an already approved issue contract.

### Superpowers
Superpowers is tactical support for TDD, systematic debugging, isolated work,
verification, and the final risk-appropriate review. It serves the selected stage and
does not own a competing lifecycle.

### ICM Architect
ICM Architect is structural only: use it when the agent/document workspace itself
needs restructuring, not as a recurring product-issue ritual.

### Narrow specialists
Use Supabase/Postgres, Cloudflare, security, Playwright/E2E, provider documentation, and other narrow specialists only when the task touches their domain.

The owner does not orchestrate skills.

---

## 8. Risk model

R1, R2, and R3 classification and verification are canonical in the root
[`AGENTS.md`](../AGENTS.md), the
[`Issue Contract`](agents/reference/ISSUE-CONTRACT.md), and
[`Security Contract`](agents/SECURITY.md). Risk follows the changed surface and
security consequence; issue wording cannot waive mandatory security or CI gates.

---

## 9. Product objective

Aromatika launches as a normal open Bulgarian perfume marketplace.

There is no permanent “public beta” access model.

Internal terms such as local development, staging, pre-launch, launch readiness, and production verification are engineering states only.

---

## 10. Registration and onboarding

Normal regular-user flow:

`register with email + password -> confirm email -> onboarding -> full marketplace access`

Onboarding requires:

- username;
- city/location;
- acceptance of Terms and Marketplace Rules.

Normal users do not require:

- invitation;
- waiting list;
- manual approval;
- phone verification;
- SMS OTP.

Staff/admin access remains separately protected with MFA.

---

## 11. Listing and seller access

After onboarding, a normal user can publish listings immediately.

There is no manual first-listing approval gate by default.

The currently approved perfume-specific listing/evidence/proof model remains in force and is not redesigned by this migration.

---

## 12. Core transaction lifecycle

Current approved marketplace flow:

`listing -> offer -> seller accepts -> private chat opens -> buyer/seller arrange payment and delivery -> seller completes OR either party cancels`

### Completion
The seller marks the deal completed.

A completed deal unlocks the applicable review flow.

### Cancellation
Either buyer or seller may cancel an accepted deal.

Cancellation requires a reason.

Cancelled deals do not unlock reviews.

Cancellation history may be retained privately for moderation/trust signals according to the approved privacy and retention model.

This supersedes prior “both users confirm” / “mutual confirmation” language.

---

## 13. Perfume payment and delivery

The perfume transaction remains off-platform.

Buyer and seller arrange:

- payment method;
- courier/delivery;
- shipping cost;
- handover details.

Aromatika does not:

- collect the perfume purchase price;
- hold escrow;
- settle seller funds;
- manage buyer refunds for the perfume itself.

No Speedy/Econt courier API integration is required for launch.

---

## 14. Geographic launch scope

Aromatika launches for Bulgaria first.

International expansion is not a launch requirement.

Do not delay launch for:

- international shipping;
- multiple countries;
- global marketplace taxation;
- international merchant rules;
- full multilingual marketplace support;
- global currencies.

---

## 15. Verified Merchants

Businesses may join from launch.

Flow:

`normal registration -> merchant application -> Aromatika verification -> Verified Merchant status/storefront`

At launch:

- merchant verification is a trust status;
- verification cannot be purchased;
- no merchant subscription is required;
- merchants use the same base listing allowance and paid-extra model as normal users;
- merchant-specific subscriptions/analytics/bulk tools remain later work unless separately approved.

---

## 16. Monetization model

Aromatika does not take commission from the perfume sale.

Aromatika monetizes marketplace services.

### Free allowance
Each account receives:

> **10 free active qualifying listings**

Counted:

- For Sale;
- For Exchange;
- Sale or Exchange.

Not counted:

- Wanted / Looking For;
- sold listings;
- removed/cancelled listings;
- expired listings.

### Paid additional listings
When the user already has 10 qualifying active listings, each additional active listing requires payment.

Each paid additional listing:

- is purchased individually;
- is valid for 30 days;
- closes earlier if sold or removed;
- may be renewed if still unsold.

Permanent paid slots and subscriptions are not required for launch.

### Paid promotion
Aromatika may sell time-limited listing visibility products such as:

- Boost/bump;
- Featured/promoted placement.

Exact launch price, duration, placement, and bundles are not fixed by this design. They are owner-approved commercial settings.

### Merchant monetization
Verified Merchants use the same base model at launch:

`10 free qualifying active listings -> paid additional listings -> optional promotion`

Merchant subscriptions are deferred.

---

## 17. Two separate monetary worlds

### Perfume purchase
`buyer <-> seller`

Aromatika does not handle this payment.

### Aromatika service purchase
`user -> Aromatika`

Examples:

- paid extra listing;
- Boost;
- Featured placement.

Aromatika must use a suitable payment provider for its own services.

The exact provider is selected in a dedicated monetization implementation design after comparing Bulgarian availability, fees, payment methods, accounting/legal implications, webhook reliability, refunds, and implementation complexity.

Provider selection, commercial acceptance, meaningful spending, and launch pricing remain owner decisions.

---

## 18. Payment-entitlement safety

A paid listing or promotion must never be granted solely because the browser claims payment succeeded.

Entitlements require trusted server-side confirmation.

Where applicable, prove:

- failed payment creates no entitlement;
- abandoned payment creates no entitlement;
- duplicate provider notifications do not create duplicate entitlements;
- user-controlled browser/API input cannot self-grant paid access;
- expiry behaves predictably;
- refund/cancellation state remains auditable;
- card details are not stored by Aromatika when the provider can handle them.

Paid-entitlement authorization is R2 work.

---

## 19. Security philosophy

Aromatika must be easy to join but strict underneath.

Security uses:

- least privilege;
- fail-closed authorization;
- database/RLS authority;
- private-data minimization;
- secure upload processing;
- staff/admin MFA;
- exact environment targeting;
- secrets hygiene;
- dependency auditing;
- backup/restore readiness;
- monitoring/alerting;
- incident response;
- independent review;
- deterministic tests.

Never weaken a security control merely to make CI, tests, a deploy, or a deadline pass.

---

## 20. Hostile-client verification

Where relevant, prove that User A cannot:

- read User B's private records;
- modify User B's listing;
- read User B's private chat;
- access User B's private evidence/uploads;
- operate moderator/admin functions;
- manipulate User B's deal;
- spoof ownership;
- grant themselves paid listing/promotion entitlements;
- bypass ownership by direct API/database calls;
- escalate privileges through user-controlled fields;
- obtain private URLs or secrets through errors.

For Supabase/Postgres security, inspect and test real policies, functions, grants, and Storage rules. Do not infer authorization correctness from frontend behavior alone.

---

## 21. Golden Path E2E

Maintain one high-value end-to-end browser journey:

1. user registers;
2. confirms email;
3. completes onboarding;
4. creates a listing;
5. uploads acceptable photos/evidence;
6. publishes;
7. second user discovers the listing;
8. second user views seller/trust information;
9. makes an offer;
10. seller accepts;
11. private chat is available;
12. seller marks the deal completed;
13. review becomes available.

Maintain a separate cancellation journey:

`accepted deal -> either party cancels -> cancellation reason stored -> review does not unlock`

Maintain safety coverage for:

- report/block;
- moderation path;
- cross-user denial;
- materially affected auth/account flows.

---

## 22. Monetization E2E

Maintain a paid-listing journey:

`10 qualifying active listings -> attempt 11th -> payment required -> trusted payment confirmation -> 30-day paid entitlement -> publish`

Also test hostile/failure cases:

- failed payment;
- abandoned payment;
- duplicate webhook;
- forged browser/API request;
- expired entitlement;
- refund/cancellation state.

Exact implementation depends on the selected provider.

---

## 23. Launch Readiness Gates

Aromatika does not launch merely because isolated features exist.

### Product
Evidence must show:

- open registration works;
- email confirmation works;
- onboarding works;
- listing creation/publishing works;
- search/discovery works;
- offers work;
- accepted-offer chat works;
- seller completion works;
- cancellation works;
- reviews work;
- a business can apply for Verified Merchant status, authorized staff can approve or reject the application, and approved status/storefront trust signals display correctly;
- paid extra listings work;
- paid promotion purchase and activation work.

### Security
Evidence must show:

- no known critical cross-user authorization failure;
- staff/admin MFA;
- private-data boundaries verified;
- private uploads/evidence verified;
- no unresolved critical security finding;
- paid-entitlement boundaries verified.

### Trust and moderation
Evidence must show:

- report flow works;
- block flow works;
- moderation path works;
- existing perfume evidence/trust flow works as designed.

### Operations
Evidence must show:

- monitoring/error reporting works;
- backups exist;
- restore has been rehearsed;
- staging/production are distinguishable;
- production secrets/config are verified;
- incident response is usable.

### Business/legal
Evidence must show:

- Terms/Privacy/Safety content is launch-ready;
- payment-provider decision is approved;
- launch pricing is approved;
- merchant/business wording is accurate.

### UX
Evidence must show:

- core mobile journey is usable;
- loading/empty/error/success states are present where needed;
- Bulgarian copy is understandable;
- no fake activity, fake reviews, fake trust, or fabricated marketplace proof;
- no engineering jargon leaks into user-facing UI.

Agents determine whether technical gates pass. The owner makes the final business decision to launch.

---

## 24. GitHub operating model

GitHub is the reviewed shared baseline and integration safety rail.

Desired `main` behavior:

- feature/security development does not happen directly on `main`;
- PRs carry proposed changes and review evidence;
- required CI passes before integration;
- unresolved required findings block completion;
- force pushes are disabled;
- deletion is protected;
- agents do not bypass required checks;
- R1/R2 may merge autonomously when all policy requirements pass;
- R3 external/protected actions remain owner-gated.

Merge and deploy remain separate concepts.

GitHub protection must be configured only after verifying actual account/repository capability.

---

## 25. Launch Readiness Queue

GitHub Issues are the sole engineering queue. The owner-approved active issue is the
executable specification for its explicit decisions. Current product, design,
architecture, security, and status documents remain governing evidence for concerns
the issue does not explicitly decide; issue wording cannot silently downgrade a
security invariant or redefine product intent.

The queue should remain intentionally small, usually about 5–9 evidence-backed active issues.

Priority:

- **P0** — active safety/data-loss/security blocker;
- **P1** — blocker to core launch journey;
- **P2** — launch-value UX/accessibility/performance/reliability improvement;
- **P3** — later/deferred.

Issues describe outcomes, not low-level chores.

Each ready issue contains:

- outcome;
- user/safety reason;
- acceptance criteria;
- required verification;
- risk level;
- dependencies;
- explicit out-of-scope items.

After a successful merge, the system updates current truth when needed, reconciles and
closes the issue, and reports the next live-verified unblocked issue. It stops before
starting that issue unless existing owner authority explicitly authorizes continuation.

---

## 26. Model routing and cost discipline

Use deterministic evidence before model delegation, one lead, bounded subagents only
for independent work, and no review before the candidate is materially final. The
canonical routing and credit rules are in
[`docs/agents/reference/MODELS-AND-TOOLS.md`](agents/reference/MODELS-AND-TOOLS.md).

---

## 27. Repair and failure behavior

Classify each blocker through the canonical
[`Issue Contract`](agents/reference/ISSUE-CONTRACT.md). Deterministic defects inside
approved scope remain agent-owned regardless of repair count; transient infrastructure
failure preserves the exact candidate and never licenses gate weakening. Stop only at
a real owner/protected boundary, exhausted transaction envelope, explicit owner stop,
or safety-policy interruption. For security work, inability to prove safety remains a
stop condition.

---

## 28. Migration from the August 15 package

Implementation proceeds in this order.

### Phase 0 — Establish this new design
Create this file locally at:

`docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`

Reduce `MASTER-PLAN.md` to a short roadmap/index.

Mark the August 15 design/plans as superseded historical evidence once the new design is in force.

### Phase 1 — Correct and execute Agent Instruction Migration
Retain the strong structure of the August 15 plan, but update:

- beta language -> Launch Readiness;
- local workspace -> active working authority;
- GitHub `main` -> synchronized reviewed baseline;
- mandatory `Sync status`;
- GitHub Issues -> sole engineering queue and executable specification for explicit
  owner-approved decisions, without authority to downgrade security invariants.

Create/maintain:

- concise `AGENTS.md`;
- `docs/agents/WORKFLOW.md`;
- `docs/agents/SECURITY.md`;
- legacy pointers instead of duplicate authorities.

### Phase 2 — Correct and execute Repository Truth Cleanup
Explicitly reconcile:

- `PRODUCT.md`;
- `MASTER-PLAN.md`;
- `docs/PROJECT-STATUS.md`;
- `docs/LAUNCH-GATES.md`;
- `docs/BUSINESS-MODEL.md`;
- `README.md`;
- catalog/UI visual conflicts;
- architecture/ops duplication;
- stale `.builder`;
- dated Superpowers plans/reviews.

Encode:

- open registration;
- email confirmation;
- onboarding;
- no normal-user invite/phone/SMS gate;
- immediate seller access;
- seller-completes-deal;
- either-party cancellation;
- Bulgaria-only launch;
- off-platform perfume payment/delivery;
- 10 free qualifying active listings;
- paid 11th+ listings for 30 days;
- paid promotion;
- Verified Merchants at launch;
- no merchant subscription required.

### Phase 3 — Correct and execute GitHub Safety + Launch Readiness Queue
Retain:

- PR/CI safety;
- branch protection;
- no owner code-review gate;
- autonomous R1/R2 merge when evidence passes;
- small outcome-oriented queue.

Rename/reframe:

- Open Beta Queue -> Launch Readiness Queue;
- beta milestone -> launch milestone.

### Phase 4 — Reconcile actual code against current truth
Do not assume plans describe current code perfectly.

Inventory:

- what already works;
- what partly works;
- what is demo-only;
- what works locally but not hosted;
- what is genuinely missing;
- what contradicts current product truth.

Create only evidence-backed launch issues.

### Phase 5 — Complete the core product
Prioritize:

`registration -> email confirmation -> onboarding -> profile -> listing -> discovery -> offer -> accept -> chat -> seller completion/cancellation -> review`

Plus:

- reports;
- block;
- moderation;
- merchant verification;
- evidence/trust;
- private-data protections.

### Phase 6 — Implement monetization
1. design/select payment provider;
2. owner approves provider/pricing/business decisions;
3. implement paid listing entitlements;
4. implement 30-day expiry/renewal;
5. implement promotion products;
6. implement payment security tests;
7. verify production behavior.

### Phase 7 — Launch hardening
Close only genuine launch blockers:

- security findings;
- missing E2E coverage;
- production configuration;
- monitoring;
- backup/restore;
- legal/safety content;
- payment production readiness;
- major mobile UX blockers;
- moderation readiness.

Do not invent speculative readiness gates merely to keep engineering busy.

### Phase 8 — Final launch decision
Agents provide a plain-language readiness handoff:

- technical readiness;
- security readiness;
- business dependencies;
- exact owner action;
- sync status;
- rollback/stop condition.

The owner decides when Aromatika opens to the public.

---

## 29. Offline owner package

The live authority remains the local project.

After this design/planning cycle, maintain a self-contained recovery/transfer package containing copies of:

- this Launch Readiness Design;
- revised Agent Instructions implementation plan;
- revised Repository Truth plan;
- revised GitHub Safety + Launch Readiness Queue plan;
- revised Implementation Handoff.

The owner package is a snapshot for recovery/transfer, not a second live authority.

Its purpose is to let the owner give a new coding session the complete approved package if the workspace ever becomes confusing.

---

## 30. Non-goals of this design migration

This design migration does not itself:

- redesign the application UI;
- implement marketplace features;
- choose the final payment provider;
- set exact launch pricing;
- enable shipping integrations;
- add merchant subscriptions;
- build a mobile app;
- expand internationally;
- perform destructive production actions;
- launch Aromatika.

Its purpose is to establish one coherent launch model and one coherent engineering operating model before implementation proceeds.

---

## 31. Acceptance criteria for this design migration

The migration is complete when:

1. this design is the current strategic authority;
2. `MASTER-PLAN.md` is reduced to an index/roadmap;
3. local workspace authority and GitHub synchronization rules are explicit;
4. all active docs use Launch Readiness rather than Open Beta as the strategic objective;
5. normal users can register without invite/phone/SMS gates in current product truth;
6. transaction truth uses seller completion and either-party cancellation;
7. 10-free / paid-extra / 30-day / promotion monetization is current launch truth;
8. Bulgaria-only launch scope is explicit;
9. perfume payment/delivery remains off-platform;
10. Verified Merchants are part of launch without a required subscription;
11. Agent System V2 keeps Matt primary for shaping, Superpowers tactical, and ICM
    structural only;
12. R2 code is independently reviewed/tested rather than owner-approved;
13. R3 owner-level operations remain protected;
14. `Sync status` is part of owner handoffs;
15. GitHub becomes the synchronized execution/integration layer rather than the highest product authority;
16. historical August 15 material cannot silently override current truth;
17. Launch Readiness Queue exists and is evidence-backed;
18. the repository can continue autonomous normal/R2 work without requiring the owner to review code;
19. launch gates include product, security, moderation, operations, business/legal, monetization, and UX evidence;
20. the owner retains the final decision to launch.

---

## 32. Approved operating principle

> Aromatika should behave like a small engineering team working for a nontechnical product owner. The owner decides product, business, legal, spending, and real-world launch choices. The local PC workspace is the active working authority. The root router and selected stage contract govern execution; Matt shapes, Superpowers supports tactical engineering, and ICM supports structural workspace changes. Specialist skills contribute only where needed. Deterministic evidence precedes model delegation, and stronger models are reserved for difficult or high-consequence reasoning. Tests, security evidence, final risk-appropriate review, and CI determine technical readiness. GitHub protects and publishes the reviewed shared baseline. Every task explains what changed, what the owner must do if anything, the local/GitHub sync state, what happens next, and when the system must stop.
