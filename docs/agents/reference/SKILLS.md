# Skill Routing

Skills add focused methods inside the repository lifecycle. They never outrank the
authority ladder, create a second queue, or duplicate the issue lifecycle.

## Manifest

| Capability | Workflow role | Trigger | Non-trigger | Precedence | Install/source identity |
| --- | --- | --- | --- | --- | --- |
| Matt Pocock skills (`grill-with-docs`, `wayfinder`, `to-spec`, `to-tickets`, `implement`) | Primary shaping workflow | Ambiguous discussion, multi-session shaping, or implementation explicitly routed from an executable issue | Routine ceremony or duplicate specs for an approved issue | Shapes work before tactical execution | User layer under `~/.agents/skills`; owner-selected Matt Pocock skill bundle |
| Superpowers | Tactical implementation and verification | TDD, systematic debugging, isolated worktrees, completion checks, final engineering review, and R2 adversarial review | Process ownership, duplicate planning, or an intermediate review conveyor | Serves the selected stage and issue | User-managed Codex plugin; canonical installed release `6.3.0` at migration time |
| ICM Architect | Workspace architecture and restructure | Agent/document topology changes, a new multi-stage map, material instruction drift, or failed cold-agent navigation | Ordinary product issues or recurring ticket ritual | Structural only; owner-approved architecture controls | User layer `~/.agents/skills/icm-architect`; `RinDig/icm-architect` at `e16cafe6a664dcf6d787a726b452adba77d913f4` |
| Impeccable | UI/design-specific method | UI critique, design-system, interaction, or visual-polish work | General workflow or backend work | Conditional specialist | User-managed plugin installation |
| Security, database, Svelte, browser, and provider specialists | Domain depth | The approved issue touches the corresponding surface | Default startup or unrelated work | Conditional; [`../SECURITY.md`](../SECURITY.md) governs R2/R3 | User/plugin/project layer appropriate to the tool |

Engram is supporting memory, not a skill or authority. Its use is defined in
[`MEMORY.md`](MEMORY.md).

## Shaping routes

- **Clear and small:** inspect → implement → verify → final review.
- **Discussion-sized:** `grill-with-docs` → resolve decisions → implement.
- **Clear but multi-session:** `grill-with-docs` → `to-spec` → `to-tickets` → fresh
  implementation sessions per ticket.
- **Foggy and multi-session:** `wayfinder`/research → resolve decisions → `to-spec` →
  `to-tickets` → implementation.

`grill-with-docs` inspects the repository for facts, separates facts from decisions,
asks one recommended decision question at a time only when necessary, and resolves
dependency branches before implementation.

Inventory before installation. Keep one canonical same-name install, preserve the
owner-selected source, and do not vendor personal skills into this product. Reload
Codex at most once when discovery requires it and confirm discovery once.

