# Tooling and Engineering Skill Routing

## Product-engineering lane

- `AGENTS.md` — repository and authority contract.
- `docs/agents/WORKFLOW.md` — executable issue lifecycle.
- `docs/agents/HUMAN-GATES.md` and `docs/agents/SECURITY.md` — R2/R3 triggers.

## Tooling-specialist lane

When a tooling candidate is active, include only these specialist layers:

- **Matt Pocock / Superpowers orchestration**:
  `grill-with-docs`, `domain-modeling`, `research`, `codebase-design`,
  `to-spec`, `to-tickets`.
- **Verification lane**:
  `verification-before-completion`, `systematic-debugging`, `testing` skills as needed.
- **Infrastructure lane**:
  `.codex/config.toml` wrapper checks, CodeGraph and Svelte MCP wrapper validation,
  deterministic config contracts.

## Tool routing (authoritative for tooling)

- `docs/agents/TOOLING-RUNBOOK.md` defines the canonical startup and check sequence.
- `AGENTS.md` and `WORKFLOW.md` remain governance authority.

## Process consolidation

- One process owner per lifecycle step (Matt Pocock OR Superpowers); no duplicate
  parallel life-cycles for the same step.
- Read each needed reference once and avoid legacy pointer duplication.
