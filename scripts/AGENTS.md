# scripts AGENTS.md

## Scope
Operational and verification scripts live here.

## Expectations
- Keep scripts explicit, idempotent and safe by default.
- Prefer dry-run or confirmation flags for destructive operations.
- Do not hard-code secrets or production environment details into scripts.
- When changing a script that affects staging, backup or restore, verify the relevant workflow before shipping.

## Common entry points
- backup and restore flows
- catalog seeding and validation
- staging database operations
- production readiness checks
