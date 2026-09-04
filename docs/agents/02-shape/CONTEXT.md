# Stage 02 — Shape

## Job

Turn live issue authority into an executable acceptance, journey, risk, and proof
contract without duplicating the approved issue.

## Inputs

- Stage 01 output
- Live issue body, owner approval, dependencies, labels, comments, and exclusions
- [`../reference/ISSUE-CONTRACT.md`](../reference/ISSUE-CONTRACT.md)
- Conditional product, design, architecture, launch, business, and
  [`../SECURITY.md`](../SECURITY.md) references
- Skill routing in [`../reference/SKILLS.md`](../reference/SKILLS.md)

## Procedure

1. Classify the work as clear and small, discussion-sized, clear but multi-session,
   or foggy and multi-session; select the Matt shaping route recorded in the skill
   reference.
2. Inspect the repository for facts, separate facts from decisions, and resolve
   dependency branches in order. Ask one recommended owner question only for a
   material decision live evidence cannot supply.
3. Map every acceptance criterion to the user journey, likely changed surface,
   focused evidence, relevant regressions, configuration/documentation, and explicit
   exclusions.
4. Classify R1/R2/R3 from the changed surface and security consequence. Identify
   provider capability needs and the bounded external transaction before work is
   frozen or provisioned.
5. Record the definition of done in the issue or PR-facing evidence. For an already
   executable issue, use the issue as the specification and create no duplicate
   spec, plan, roadmap, SDD artifact, or ticket tree.

## Output

An executable issue contract with acceptance map, journey matrix, risk, proof
requirements, exclusions, and no unresolved implementation-blocking decision.

## Human gate

none — agent-owned unless shaping exposes one exact product, architecture, legal,
commercial, spending, or protected-action decision

## Stop conditions

- A material owner decision remains unresolved after repository and live-state
  inspection.
- The issue lacks approval, testable acceptance criteria, explicit scope, or verified
  dependencies.
- Required work would exceed the approved external transaction envelope.

