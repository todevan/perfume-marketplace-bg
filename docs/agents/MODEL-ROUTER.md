# Model Router

## Principle
Spend intelligence where mistakes are expensive. Spend cheap tokens where work is mechanical.
These are capability tiers, not permanent vendor bindings.

## SCOUT
Cheapest reliable model for:
- repository search;
- locating files/tests;
- evidence collection;
- log summarization;
- simple documentation cleanup;
- mechanical low-risk edits.

SCOUT gathers evidence but does not make the final R2 judgment.

## BUILDER
Cheap/medium capable coding model for:
- straightforward UI;
- simple bugs;
- routine tests;
- bounded mechanical refactors;
- implementation with already-clear security/architecture boundaries.

## LEAD
Strong model for:
- architecture;
- difficult debugging;
- ambiguous/high-impact work;
- database/domain design;
- important business logic;
- payment/entitlement design;
- resolving reviewer disagreement;
- deciding whether lower-tier work is safe to accept.

## REVIEWER
Separate context from implementer and strong enough for the risk.
R1: independent capable reviewer.
R2: independent strong reviewer.

## CRITICAL
Not a model name:
`strong LEAD + independent strong REVIEWER + adversarial security review + deterministic evidence`
Use for R2.

## Escalation
Start at the cheapest safe tier.
Escalate when:
- security/privacy/auth/RLS/payment entitlement is involved;
- architecture/database invariants are unclear;
- repeated focused tests fail;
- evidence contradicts expected design;
- reviewer disagreement cannot be resolved cheaply;
- blast radius is high.

If strong reasoning reduces the remainder to mechanical work, delegate mechanics downward and review the result.

## Context packets
Delegated workers receive only:
- task/outcome;
- relevant files;
- constraints;
- acceptance criteria;
- required tests/evidence.

Do not paste the whole repository history/governance into every subagent.

## Spawn discipline
Default: one task owner.
Delegated workers do not recursively create large agent trees unless the lead explicitly authorizes a defined independent parallelization need.

## Retry budget
1. diagnose and repair;
2. retry using new evidence/different approach;
3. escalate only when justified.
After repeated failure, stop instead of burning tokens indefinitely.

## Cost rules
1. Start with the cheapest model suitable for risk.
2. Escalate on demonstrated complexity/consequence.
3. Do not use several strong agents for routine work.
4. Minimize delegated context.
5. Prefer tools/tests/search over another LLM opinion.
6. Avoid duplicate generic reviews.
7. Stop unproductive retry loops.
8. Do not perform speculative refactors.
9. Do not research deferred features without an active need.
10. Optimize for safe progress per token.