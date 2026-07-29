# tests AGENTS.md

## Scope
This folder contains unit, contract and end-to-end tests for the marketplace.

## Expectations
- Prefer testing the real behavior of services, routes and contracts rather than mock-only behavior.
- Keep tests aligned with the current workflow: auth, listings, offers, deals, moderation and uploads.
- Add or update tests when changing rules, validation or user-visible behavior.

## Typical commands
- pnpm test:unit
- pnpm test:e2e
- pnpm test:db:contracts
