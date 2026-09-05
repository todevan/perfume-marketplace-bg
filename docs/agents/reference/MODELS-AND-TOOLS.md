# Models and Tools

## Configuration layers

Personal defaults belong in `~/.codex/config.toml`; repository requirements belong in
[`../../../.codex/config.toml`](../../../.codex/config.toml). Back up both user skill
and Codex configuration to a private mode-700 local archive before user-layer edits.
Keep backups outside the repository and never expose secret values.

Do not pin a primary model in repository configuration. Repository reasoning defaults
to `medium`; stronger model/reasoning is selected for the bounded task, never inherited
merely because the issue is R2/R3. Validate the effective merged configuration from both
the canonical clone and the active worktree. Runtime child metadata is authoritative
evidence of which model and reasoning effort actually ran.

## Model and delegation routing

Risk classification and model selection are separate decisions. Use deterministic tools
before model delegation and select the lowest capable route for each bounded task.

| Work class | Typical scope | Default route |
| --- | --- | --- |
| **M0 — Mechanical** | Search, inventory, deterministic commands, CI/status inspection, test/log parsing, straightforward source lookup, and other read-only mechanical evidence | `gpt-5.6-luna` / `low` |
| **M1 — Normal engineering** | Bounded implementation, ordinary bugs, tests, refactors, normal application code, straightforward migrations | `gpt-5.6-terra` / `medium` |
| **M2 — Complex integration** | Difficult migrations, recovery/data-flow work, complex state machines, cross-system integration | `gpt-5.6-terra` / `high`; use `gpt-5.6-sol` / `high` only when stronger architectural judgment is materially required |
| **M3 — Critical reasoning** | Auth/RLS/security architecture, irreversible boundaries, destructive/provider uncertainty, high-consequence ambiguity | `gpt-6-astra` / `high` |

`xhigh` is exceptional and requires a concrete unresolved high-consequence ambiguity.
`max` requires explicit exceptional justification. Never use either for deterministic or
mechanical work.

An intentionally routed worker must resolve to a native/custom role or supported spawn
configuration that defines both model and reasoning effort. Never rely on accidental
inheritance from an expensive root session. Prompt wording alone is not routing proof;
when runtime metadata is available, the actual child model and reasoning effort win.

Delegate only bounded work that materially benefits from delegation. Pass the worker the
minimum acceptance context, files/symbols, existing evidence, direct dependencies, and
verification needed for that task. Do not delegate merely to create activity or make
multiple workers rediscover the same repository context.

Keep trivial deterministic writes inline when that is cheaper than delegation.
Delegated file-changing work uses a write-capable implementation role unless a
separately configured and runtime-verified M0 write route exists.

## Final review routing

- R1 engineering review defaults to `gpt-5.6-terra` / `high`.
- R2 engineering review defaults to `gpt-5.6-terra` / `high`; use
  `gpt-5.6-sol` / `high` only when the changed architecture materially requires it.
- R2 adversarial/security review defaults to `gpt-6-astra` / `high`; use `xhigh`
  only for a concrete unresolved high-consequence security ambiguity.

Give each reviewer the exact base/final SHA, final diff, changed-file/acceptance map,
relevant invariants, existing deterministic evidence, and only the direct dependencies
required to understand the changed path.

Each required reviewer performs one initial independent pass and reports material
findings only. Independent reviewers may discover the same defect; the accountable lead
deduplicates findings before repair. Incomplete assigned coverage is `INCOMPLETE`, never
`PASS`.

If the candidate changes, rerun affected deterministic evidence and obtain focused
final-SHA re-attestation for repaired hunks and their interactions with prior findings.
Do not restart unchanged repository-wide analysis unless the changed surface materially
expands.

## Conditional routing

| Tool | Use when | Boundary |
| --- | --- | --- |
| GitHub | Reading the live issue queue, PRs, CI, reviews, rulesets, labels, and closure | Permission gaps remain unknown, not inferred |
| CodeGraph | Structural relationships, call flow, impact, and scoped code exploration | Each worktree has its own index; use deterministic source fallback when unavailable |
| Svelte MCP | Current Svelte/SvelteKit documentation and autofix questions | Project wrapper must resolve inside the current worktree |
| Context7 | Current official library documentation may differ from internal knowledge | Load only for the relevant library question |
| Playwright | Browser/E2E and visible user journeys | Follow the hosted browser and secret-capture boundary |
| Cloudflare observability | Bounded hosted evidence or incident diagnosis | Enable only for the approved target and scope |
| Supabase/provider tools | Exact hosted issue transaction | Provider mutation requires the authorized envelope |
| Engram | Focused continuity | Follow [`MEMORY.md`](MEMORY.md); live state wins |

The project-locked CodeGraph and Svelte launchers are
[`run-codegraph-mcp.mjs`](../../../scripts/run-codegraph-mcp.mjs) and
[`run-svelte-mcp.mjs`](../../../scripts/run-svelte-mcp.mjs). Validate their existing
contract tests and effective configuration rather than duplicating raw servers. A
wrapper or MCP initialization failure is scoped migration/debugging evidence, not a
reason to restart authorized work or demand host repair before deterministic
fallbacks are exhausted.

The project config keeps pinned, disabled `svelte` and `playwright` aliases only to
override user-wide servers inside Aromatika. They are not a second active Svelte
route. The repository-locked `aromatika-svelte` wrapper is the sole active project
Svelte server; browser proof uses the locked repository Playwright dependency unless
an approved task explicitly selects another tool.

Remove dead or duplicate configuration only after confirming no consumer, preserving
a backup, and proving the effective configuration. Newly added remote tooling must be
pinned. Avoid broad plugin or host migrations during product work.

## Credit discipline

Keep one accountable lead. Review only after freeze, never repeat unchanged repository,
tool, skill, or historical discovery, and load only context needed for the current issue
and bounded task.

Passing deterministic evidence is consumed rather than regenerated. During implementation
run focused meaningful checks and affected regressions. Run each full required project or
risk gate once for a materially changed verification candidate, then repeat it only when
the candidate changed, evidence became stale, a test failed, or a concrete unresolved
concern requires it.

Do not generate receipt files whose only purpose is to show activity or ask questions
that live evidence can answer.
