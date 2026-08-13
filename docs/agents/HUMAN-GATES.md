Да — този също го **запазваме като основа**, защото H1–H6 са много важни. Само го правим напълно съвместим с новата система и изрично забраняваме Superpowers/Matt/ECC да измислят допълнителни стопове.

Замени **целия**:

```text
docs/agents/HUMAN-GATES.md
```

с това:

````md
# Human Gates

## Purpose

These are the normal reasons an autonomous agent stops and asks the owner something.

If none applies, the agent should keep working.

The owner is not expected to read code or make ordinary engineering decisions. Present the plain-language view first and expose technical detail only on request.

The unified agent stack does not create additional Human Gates:

- **Superpowers** owns engineering process.
- **Matt Pocock skills** provide engineering-depth assistance.
- **ECC/repository/platform skills** provide specialist expertise.
- **Repository Human Gates** determine when owner interruption is actually required.

A generic skill asking for confirmation does not automatically create a Human Gate.

Standing autonomy granted by `AGENTS.md` satisfies routine approval checkpoints for reversible technical decisions.

No skill may:

- waive a Human Gate;
- create an unnecessary owner gate;
- downgrade an H3/H4/H5 condition;
- treat owner silence as approval;
- broaden an approved action.

---

# General gate discipline

Before presenting any Human Gate:

1. finish all safe autonomous investigation;
2. finish all safe implementation/preparation;
3. gather relevant evidence;
4. verify the gate is genuinely required;
5. determine the smallest owner decision/action needed;
6. present only that decision/action.

Do not ask the owner to diagnose a technical problem the agent can investigate itself.

Do not ask the owner implementation-detail questions that repository patterns, specifications, tests or specialist reasoning can safely resolve.

Ask one owner decision at a time whenever practical.

Prefer:

- plain language;
- numbered choices;
- one recommended option;
- concise consequences;
- explicit target environment;
- exact next action.

Avoid:

- large raw logs;
- unnecessary stack traces;
- secrets;
- unexplained technical jargon;
- vague requests such as “check Supabase”;
- asking for approval before autonomous preparation is complete.

---

# H1 — Product behavior decision

## Trigger

Use H1 when two or more technically valid choices create meaningfully different user behavior and current authoritative product documentation does not decide between them.

Examples:

- what “block user” means;
- message edit/delete window;
- visibility of completed listings;
- interaction while a moderation case is open;
- whether an expired offer remains visually distinct from another terminal state;
- materially different onboarding/user-flow semantics.

Do **not** trigger H1 merely because multiple technical implementations are possible.

Examples that normally do **not** require H1:

- choosing between two internal helper abstractions;
- choosing where a repository-consistent function belongs;
- deciding a safe test seam;
- choosing a reversible implementation pattern;
- deciding whether to extract a small component;
- selecting a reasonable internal type structure.

Matt `domain-modeling` and `codebase-design` should be used first when the apparent ambiguity may actually be an engineering/domain-modeling question rather than a product decision.

If the ambiguity remains a genuine user-facing choice after technical analysis, trigger H1.

## Required format

```text
PRODUCT DECISION REQUIRED

Issue: #<number> — <title>

Question:
<one plain-language question>

Recommended option:
1. <recommended behavior>

Why I recommend it:
<2–5 concise sentences>

Other viable options:
2. <alternative>
3. <alternative, only when genuinely distinct>

What your choice affects:
<short consequences>

What I already completed:
<safe investigation/preparation already finished>

Reply with: 1, 2 or 3.
````

## After resolution

After the owner chooses:

1. record the decision in the appropriate authoritative project source;
2. include date/reasoning where project documentation requires it;
3. remove/reconcile the corresponding open question if applicable;
4. continue autonomous engineering.

Do not repeatedly ask the same resolved question in later sessions.

---

# H2 — Legal / privacy / business decision

## Trigger

Use H2 when correctness depends on:

* owner policy;
* business strategy;
* legal judgement;
* privacy policy;
* retention policy;
* commercial policy;

rather than engineering alone.

Examples:

* retention period;
* legal copy or guarantee language;
* merchant verification policy;
* payment/business-model activation;
* public indexing policy;
* data deletion/anonymization policy not already documented;
* moderation retention/legal-hold decisions;
* business consequences of account states;
* support/appeals policy.

Technical feasibility does not determine H2.

A specialist may explain technical consequences but cannot make the owner decision.

## Required format

```text
OWNER POLICY DECISION REQUIRED

Issue: #<number> — <title>

Decision needed:
<plain-language question>

Why engineering cannot decide this safely:
<reason>

Recommended product/operational default:
<option, clearly labelled as not legal advice when applicable>

Alternatives:
<up to two>

What each option affects:
<brief consequences>

What I can continue doing without this decision:
<safe preparatory work or “nothing further on this issue”>

Reply with the option you want, or ask for a simpler explanation.
```

## Legal discipline

Never fabricate legal certainty.

When applicable say clearly that:

* the recommendation is an engineering/product default;
* it is not legal advice;
* professional legal review may still be appropriate.

Do not use a technical skill, security review or web search to silently turn an owner/legal policy question into an engineering decision.

## After resolution

Record the final owner decision in the appropriate authoritative project document.

Do not leave resolved H2 decisions only in chat history.

---

# H3 — High-risk merge approval

## Trigger

Trigger H3 only **after** an R2 change is fully ready to merge.

Before H3, agents autonomously complete:

* implementation;
* focused tests;
* full applicable verification;
* security specialist review;
* platform/database specialist review where triggered;
* independent engineering review;
* review-finding repairs;
* PR preparation;
* CI repair;
* final diff inspection.

Do not trigger H3 early merely because the change is R2.

A green R2 PR waits for the owner.

## H3 readiness requirements

H3 may be presented only when:

* implementation is complete;
* final risk class is confirmed R2;
* required tests passed freshly;
* required specialist review completed;
* independent code review completed;
* GitHub required checks are green;
* no unresolved Critical/Important findings remain;
* PR is otherwise mergeable;
* no unrelated scope expansion remains unresolved.

Superpowers `verification-before-completion` should be satisfied before presenting H3.

Matt `code-review` may provide the detailed engineering review.

ECC `security-review` should be used when the security trigger applies and is available.

## Required format

```text
HIGH-RISK CHANGE READY FOR REVIEW

Issue: #<number> — <title>

What changed:
<plain language>

Why this change exists:
<plain language>

Why this is high risk:
<short explanation>

What could go wrong if this change is wrong:
<realistic risk, no alarmism>

Security/data impact:
<plain-language boundary affected>

Verification completed:
✓ <focused tests>
✓ <type/static/build>
✓ <DB/RLS tests if applicable>
✓ <browser/E2E flow if applicable>
✓ <security/specialist review>
✓ <independent code review>
✓ GitHub CI

Unresolved Critical/Important findings:
None.

Residual risk:
<None / concise remaining non-blocking risk>

Recommended decision:
APPROVE MERGE

Your choices:
1. Approve merge
2. Reject / send back for revision
3. Explain this in simpler terms
4. Show me the technical details
```

## H3 rules

If unresolved Critical/Important findings exist:

> the change is not H3-ready.

Continue autonomous repair or trigger H6 if repair budgets are exhausted.

Do not use:

* reviewer approval;
* CI approval;
* security specialist PASS;
* subagent approval;

as a substitute for explicit owner H3 approval.

## After approval

After explicit approval:

1. merge using the repository-approved method;
2. verify actual merge result;
3. verify resulting target branch state where relevant;
4. reconcile issue/PR state;
5. continue according to `EXECUTION-LOOP.md`.

Record H3 approval in the PR/issue without sensitive information.

---

# H4 — Production / credential / protected provider action

## Trigger

Use H4 when a protected external or production action requires owner involvement.

Examples:

* production secret/provider configuration;
* production migration application;
* DNS change;
* protected production setting;
* credential rotation;
* credential connection;
* first-time protected provider authorization;
* production Worker/provider mutation;
* actions requiring the owner's authenticated dashboard session;
* provider actions which tooling cannot safely perform autonomously.

H4 may also apply to staging when the specific approved gate explicitly reserves a provider mutation for the owner.

Standing staging autonomy does not override a narrower gate.

## Agent responsibilities before H4

Before involving the owner:

1. diagnose the technical problem;
2. identify the exact provider;
3. identify the exact account/project;
4. identify the exact environment;
5. identify the current verified state;
6. identify the exact required mutation;
7. prepare relevant tests/dry-runs;
8. prepare rollback when applicable;
9. determine exact verification afterward.

Use Matt/repository `wizard` when available to prepare human-executable steps.

The owner should perform the protected action — not perform the technical diagnosis.

## Required format

```text
OWNER ACTION REQUIRED

Purpose:
<what this unlocks>

Provider:
<exact provider>

Project/account:
<exact target>

Environment:
PRODUCTION / STAGING / protected provider

Current verified state:
<short factual description>

I have already prepared:
✓ <tests/dry-run>
✓ <backup if applicable>
✓ <rollback if applicable>
✓ <post-action verification>

Do this:
1. <exact navigation/click step>
2. <exact field/action>
3. <exact save/confirmation step>

Do NOT change:
<important nearby settings that are outside scope>

Do NOT send me:
<secret/password/token categories>

Expected result:
<what the owner should see>

When finished, reply:
done

I will then verify the result automatically where possible.
```

## Credential discipline

Never request that the owner paste a production secret into ordinary chat when a secure path exists.

Prefer:

* provider secret UI;
* environment-variable UI;
* secret manager;
* Wrangler secret prompt;
* other secure provider mechanism.

The agent may ask the owner to confirm that a secret was entered/configured.

The agent should not ask for the secret value itself unless the secure workflow genuinely requires it and repository policy permits it.

## After owner action

Do not immediately assume success.

Verify independently where tooling permits:

* provider state;
* deployment/version state;
* expected application behavior;
* required gate evidence.

Owner saying “done” proves the manual step was attempted, not necessarily that the resulting system state is correct.

---

# H5 — Destructive / irreversible operation

## Trigger

Trigger H5 before actions such as:

* production data deletion;
* destructive production migration;
* infrastructure destruction;
* destructive Storage operation;
* protected history rewrite;
* irreversible provider mutation;
* deletion of recovery material;
* destructive bulk operation;
* any action with meaningful irreversible loss.

“All tests pass” can never bypass H5.

A skill cannot approve H5.

## Required preparation

Before H5:

1. establish exact target;
2. establish exact scope of loss/change;
3. verify backup/recovery status;
4. verify safer alternatives;
5. identify rollback/recovery limitations;
6. finish all non-destructive preparation.

## Required format

```text
DESTRUCTIVE ACTION APPROVAL REQUIRED

Action:
<exact operation>

Target:
<exact environment/resource>

Why it is necessary:
<reason>

What will be lost/changed:
<scope>

Backup/recovery status:
<verified evidence>

Recovery limitations:
<what may not be recoverable>

Safer alternative considered:
<option or “none available”>

Recommended decision:
<approve / do not proceed>

Your choices:
1. Approve the described action
2. Do not proceed
3. Explain consequences more simply
4. Show technical details
```

## Scope discipline

Approval applies only to the exact described operation and target.

H5 approval for:

> delete resource X

does not authorize:

> delete X plus related resources Y and Z.

If scope materially changes:

> present a new H5.

---

# H6 — Automation exhausted

## Trigger

Trigger H6 only after the applicable repair budget in `EXECUTION-LOOP.md` is genuinely exhausted.

Default budgets:

* focused implementation/test failure: 3 materially different repair attempts;
* CI failure: 3 materially different root-cause repair attempts;
* serious review finding: 3 review/fix cycles;
* hosted/staging ambiguity: 2 materially different evidence-based attempts.

Do not trigger H6 merely because:

* the first fix failed;
* the error looks difficult;
* an external provider behaved unexpectedly;
* one specialist was unavailable.

Use Superpowers `systematic-debugging` before exhaustion where applicable.

Use Matt `diagnosing-bugs` when deeper causal reasoning is useful.

Use relevant ECC/platform specialists when their trigger applies.

## A materially different attempt

A new attempt must involve:

* a different evidence-supported hypothesis; or
* materially new evidence changing the diagnosis.

These do not count as new attempts:

* repeating the same command;
* editing the same logic in a cosmetically different way;
* restarting without new evidence;
* weakening a failing test;
* making unrelated changes.

## Required format

```text
AUTOMATION BLOCKED

Issue: #<number> — <title>

What is failing:
<one concise description>

Evidence:
<key error/check without large logs or secrets>

What I tried:
1. <materially different attempt + result>
2. <materially different attempt + result>
3. <attempt + result, when budget is three>

What has been ruled out:
<important eliminated hypotheses>

Current best explanation:
<hypothesis with confidence>

What remains unknown:
<remaining uncertainty>

Production state changed:
No / <exact verified change>

Recommended next action:
<single recommendation>

Your choices:
1. Continue with the recommendation
2. Hand this issue to another agent/reviewer
3. Pause this issue and continue another ready task
4. Show technical details
```

## H6 discipline

H6 is not permission to:

* lower tests;
* weaken security;
* broaden scope;
* mutate production;
* guess provider state;
* call the task complete.

If an H4/H5 condition is discovered while debugging, use the appropriate gate rather than disguising it as H6.

---

# Gate precedence

When more than one gate appears applicable, use the gate that corresponds to the actual next protected boundary.

Examples:

### Product decision blocks implementation

Use:

> H1

not H6.

### Legal/privacy policy blocks implementation

Use:

> H2

not H1 or H6.

### R2 code is completely ready to merge

Use:

> H3.

### Provider dashboard action is required

Use:

> H4.

### Provider action is destructive/irreversible

Use:

> H5, potentially together with the relevant H4 operational context.

### Technical repair budget genuinely exhausted

Use:

> H6.

Do not stack several owner questions into one confusing mega-gate.

Resolve the earliest blocking owner decision/action first.

---

# Gate-scoped work

When work is controlled by a named gate such as:

* A7;
* A8;
* A9;
* another explicit release/security gate;

the governing gate document may define additional:

* prerequisites;
* stop conditions;
* evidence;
* authorized mutations.

Those conditions must be followed.

However, a named engineering/release gate is not automatically a new Human Gate.

Human interruption occurs only when:

* H1–H6 applies; or
* the approved gate explicitly requires owner action.

Example:

> `A9 only` does not authorize A8/A10 or unrelated provider mutations.

If A9 requires one owner-performed Supabase dashboard change:

> use H4 for that exact mutation.

Do not ask for approval for unrelated engineering work already authorized by the A9 scope.

---

# Skill-system interaction

## Superpowers

Superpowers may:

* require disciplined planning;
* require systematic debugging;
* require TDD;
* require review;
* require verification.

Superpowers may not:

* invent extra owner gates that conflict with repository standing autonomy;
* waive H1–H6;
* auto-approve H3;
* turn an R3 action into an autonomous step.

A generic approval checkpoint for a reversible technical decision is satisfied by standing repository authorization after required self-review.

## Matt Pocock

Matt skills may:

* clarify domain ambiguity;
* improve module design;
* deepen bug diagnosis;
* improve code review;
* produce owner-friendly provider instructions.

Matt skills may not:

* decide H1/H2 owner questions;
* approve H3;
* bypass H4/H5;
* invent production authorization.

`wizard` is especially useful for H4 because it should convert a diagnosed protected action into precise human instructions.

## ECC

ECC/repository/platform specialists may:

* perform security analysis;
* improve backend reasoning;
* improve E2E reasoning;
* check external documentation;
* provide specialist evidence.

They may not:

* change gate permissions;
* approve R2 merge;
* authorize production;
* replace owner policy decisions.

Specialist disagreement should be resolved through evidence and repository authority, not by asking the owner to choose between technical implementations unless H1/H2 genuinely applies.

---

# Owner communication principles

The owner-facing message should answer:

1. **Why are you stopping?**
2. **What exactly do you need from me?**
3. **What have you already done yourself?**
4. **What happens after I answer?**

Do not make the owner reconstruct context from logs.

Prefer:

> “Supabase signup is currently disabled. A9 requires it enabled, and this dashboard mutation is reserved for you. Click Authentication → Settings → Enable email signup, save, then reply done. I will verify afterward.”

Avoid:

> “Auth isn't working, can you check Supabase?”

The agent diagnoses.

The owner decides or performs the protected action.

---

# Gate resolution records

After a gate resolves:

## H1/H2

Record the decision in the authoritative project decision source.

## H3

Record approval in the PR/issue and verify actual merge afterward.

## H4

Verify resulting provider/production state and record evidence where the governing procedure requires it.

## H5

Record:

* exact approved operation;
* exact target;
* resulting state;
* recovery/backup evidence where appropriate.

## H6

Record the eventual resolution in the issue/PR when work resumes.

Do not let important owner decisions exist only in transient chat.

---

# Final gate rule

The autonomous agent should stop **rarely but correctly**.

Do not interrupt the owner because:

* a decision is technically interesting;
* a skill asks for generic confirmation;
* implementation has several valid internal designs;
* the agent wants reassurance;
* a routine test failed once.

Do interrupt the owner when:

* user-facing product behavior genuinely needs an owner decision;
* legal/privacy/business policy genuinely needs an owner decision;
* a verified R2 PR is ready to merge;
* a protected provider/production action requires owner involvement;
* an irreversible/destructive action is next;
* autonomous repair has genuinely been exhausted.

**Finish safe work first.
Ask for the smallest necessary decision.
Explain it in plain language.
Never manufacture a Human Gate.**

````