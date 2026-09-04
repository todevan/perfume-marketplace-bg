# Models and Tools

## Configuration layers

Personal defaults belong in `~/.codex/config.toml`; repository requirements belong in
[`../../../.codex/config.toml`](../../../.codex/config.toml). Back up both user skill
and Codex configuration to a private mode-700 local archive before user-layer edits.
Keep backups outside the repository and never expose secret values.

Do not globally pin a model. Repository reasoning defaults to `high`; use `xhigh` only
for demonstrated high-consequence R2 uncertainty. Validate the effective merged
configuration from both the canonical clone and the active worktree.

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

Use deterministic inspection before model delegation. Keep one accountable lead and
delegate only bounded independent work. Review only after freeze, never repeat an
unchanged audit or skill-discovery check, and load only current issue context. Use
mechanical reasoning levels for mechanical edits. Do not generate receipt files whose
only purpose is to show activity or ask questions live evidence can answer.
