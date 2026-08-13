# Domain Documentation

## Purpose

This file defines where authoritative product, domain, architecture, launch, and business context lives.

It does not define a separate planning or implementation workflow.

Repository instructions and existing project documentation remain the source of truth. Installed skills may analyze, clarify, or improve that documentation, but must not create a competing domain model or documentation hierarchy.

---

## Authoritative project guidance

This repository does not currently use a root `CONTEXT.md` or a `docs/adr/` directory.

Do not introduce either merely because an installed skill normally expects that structure.

Authoritative project guidance is provided by existing repository documentation, especially:

- `AGENTS.md`
- `docs/MASTER-PLAN.md`
- `docs/PROJECT-STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/LAUNCH-GATES.md`
- `docs/BUSINESS-MODEL.md`
- applicable documents under `docs/agents/`
- applicable approved plans under `docs/superpowers/plans/`

More specific repository instructions may define additional authoritative files for a particular subsystem, release gate, or task.

---

## Authority principle

Installed skills are reasoning and execution tools.

They are not independent sources of product truth.

The effective relationship is:

```text
Repository instructions / AGENTS.md
        ↓
Authoritative project documentation
        ↓
Current issue / approved scope
        ↓
Skill-assisted reasoning and execution
```

When a skill's default conventions conflict with repository documentation, follow the repository.

Do not silently replace established project terminology, architecture, invariants, launch sequencing, or business rules with a skill's preferred model.

## Unified skill interaction

### Superpowers

Superpowers remains the primary process authority for applicable engineering work.

Its brainstorming, planning, debugging, TDD, execution, review, and verification workflows must operate against the repository's existing domain documentation.

Superpowers plans may reference or clarify domain rules, but they do not become a competing domain source of truth.

Approved durable conclusions should be reflected in the appropriate repository documentation when needed.

### Matt Pocock skills

Matt Pocock skills provide deep engineering reasoning.

In particular, `domain-modeling` may be used to:

- identify entities and value concepts;
- expose invariants;
- clarify state transitions;
- identify invalid states;
- reason about ownership and boundaries;
- improve type/domain representations.

`codebase-design` may be used to reason about how those domain concepts should map into the codebase.

These skills must begin from existing repository domain rules rather than inventing a replacement product model.

Their output is analysis until it is:

- implemented within authorized issue scope;
- incorporated into an authoritative repository document; or
- approved through the applicable Human Gate when product behavior is genuinely undecided.

Do not create a parallel "Matt domain model" that competes with project documentation.

### ECC and specialist skills

ECC and platform specialists may provide domain-relevant constraints such as:

- security invariants;
- authentication/authorization requirements;
- backend constraints;
- Supabase/RLS behavior;
- Cloudflare/runtime constraints;
- E2E-observable behavior;
- provider-specific limitations.

These constraints should refine the existing project model.

They must not establish an independent product specification.

## Product behavior versus engineering inference

Agents may infer implementation details when repository documentation already determines the user-visible behavior.

Agents must not invent product policy when multiple valid behaviors would materially affect users.

Examples include:

- blocking semantics;
- edit/delete behavior;
- moderation visibility;
- listing lifecycle behavior;
- privacy exposure;
- account or membership state behavior.

When authoritative docs do not resolve such a choice, use the applicable Human Gate rather than allowing a skill to choose a new product rule implicitly.

Implementation-detail decisions that do not materially change product behavior should normally remain autonomous.

## Domain invariants

Existing project invariants discovered in authoritative documentation must be treated as constraints, not suggestions.

This is especially important for areas such as:

- authentication and account state;
- authorization and RLS;
- ownership;
- moderation;
- messaging;
- listings;
- uploads;
- privacy;
- staff privileges;
- MFA;
- staged release behavior.

When domain analysis reveals an apparent contradiction between code and documentation, do not immediately rewrite the documentation to match the code.

Determine whether the code is:

- intentionally newer;
- a regression;
- incomplete;
- stale; or
- operating under a newer explicit owner decision.

Resolve the contradiction through the normal issue/process/Human Gate path.

## Temporal documentation

Some project documents describe intended architecture or business rules, while others describe current implementation/release state.

Treat current-state documents such as `docs/PROJECT-STATUS.md` as temporal evidence rather than a permanent substitute for architecture or product rules.

Do not infer that an unfinished, disabled, blocked, or temporarily staged behavior is the intended final domain rule unless authoritative documentation explicitly says so.

Likewise, do not assume a planned capability is already implemented merely because it appears in the master plan or architecture documents.

## Named gates and release scope

Launch/reconciliation gates are part of the repository's domain and release authority.

If work is explicitly scoped to a named gate such as:

```text
A9 only
```

skills must reason and operate inside that boundary.

Domain analysis does not authorize:

- earlier prerequisite mutations;
- later gate work;
- unrelated provider configuration;
- production changes;
- broader cleanup.

A newly discovered out-of-scope prerequisite should be recorded as a dependency, blocker, separate issue, or Human Gate as appropriate.

## Documentation changes

Do not create new domain-documentation structures simply because a skill prefers them.

Prefer updating the existing authoritative document that already owns the concept.

For example:

- architecture decisions belong with the repository's architecture authority;
- launch sequencing belongs with launch/reconciliation documentation;
- current implementation state belongs with project-status documentation;
- business/product rules belong with the appropriate business/product authority;
- agent-operation rules belong under `docs/agents/`.

Create a new durable domain document only when the concept genuinely has no appropriate existing home and the new document reduces ambiguity rather than duplicating existing sources.

## Contradiction handling

If two authoritative project documents appear to conflict:

- do not let a skill silently choose one;
- determine whether one is clearly newer, more specific, or explicitly superseding the other;
- use repository history/current approved scope when that resolves the discrepancy;
- otherwise trigger the appropriate Human Gate if behavior or policy genuinely depends on owner intent;
- after resolution, update the durable documentation when authorized so the contradiction does not remain.

Do not preserve contradictory domain truths indefinitely.

## Core invariant

```text
Repository documentation defines the domain.
Superpowers governs the primary engineering process.
Matt Pocock skills deepen domain and design reasoning.
ECC/platform skills contribute specialist constraints.
GitHub Issues define executable work.
Human Gates resolve decisions outside autonomous authority.
```

Skills may improve the model.

They must not create a competing one.
