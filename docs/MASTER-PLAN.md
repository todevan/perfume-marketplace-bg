Perfume Marketplace — Master Plan

Purpose of this document: This is the single source of truth for the project. Any AI agent (Hermes or otherwise) working on this codebase should read this file first, every session, before doing anything else. It exists because agent sessions compact, reset, and drift — this file doesn't.

Owner: [Tedi] — the only person who can approve business/legal decisions and authorize new phases of work.

Last updated: [update this date every time the doc changes]

1. What this project is

A Bulgarian online marketplace for buying, selling, and exchanging new, pre-owned, and collectible perfumes. Private sellers, collectors, and verified merchants publish structured listings; buyers discover them through a catalogue and filters; both sides negotiate through an internal chat and structured offers; payment and delivery happen off-platform. The platform does not process payments, hold inventory, or guarantee authenticity — it provides structure, search, trust signals, and moderation.

Full concept document: docs/CONCEPT.md (save the original concept doc here if not already saved)

Target stack (confirm this matches reality — see Open Questions #1): SvelteKit, TypeScript, Supabase (Postgres + RLS), Cloudflare Workers/Pages, Playwright.

Current stage: closed beta, invite-only, pre-launch. Not yet open to the public.

2. Current state (living summary — update this section as phases complete)

Keep this section short. Full detail lives in the dated audit files below. This is just "where are we right now."

Last full audit: docs/AUDIT-2026-08-02.md
Phase currently active: Phase 1 — restore a green, buildable branch
Phases completed: Phase 0 (credential rotation — done manually by owner, Aug 2 2026)
Known blockers right now: ListingCard.svelte compiler error (fix in progress), demo-mode validation bug (fix in progress)
Branch under active work: codex/full-site-redesign (no PR open yet as of last check)

(Update this block every time a phase completes or a new blocker is found — this is the 30-second version of project status.)

3. The phase plan

This is the order of work. Do not skip ahead or combine phases unless explicitly told to. Each phase has a goal and an exit condition — don't call a phase "done" until its exit condition is actually met.

Phase	Goal	Exit condition
0	Security containment	Exposed credential rotated, removed from files, activity reviewed — DONE
1	Restore a green, buildable branch	All local checks + PR CI pass
2	Security hardening + hosted integration tests	Security boundaries hold when bypassing the UI, not just the app
3	Activate required staging providers	A real invited seller and buyer can complete the full lifecycle in staging
4	Legal and privacy completion	No placeholder legal content; data export/deletion implemented and tested
5	UX completion and regression protection	Dead controls removed/implemented; key flows have test coverage
6	Backup, monitoring, production deployment	Production can be deployed, monitored, and restored predictably
7	Post-launch maintenance	Ongoing — not a one-time exit condition

Full detail on each phase's specific tasks: see docs/AUDIT-2026-08-02.md, section 9.

4. Open questions — only the owner can answer these

These block later phases. Answer them whenever you're ready — doesn't need to be all at once.

 Confirm actual tech stack matches this doc (concept doc said Next.js/Prisma; real repo uses SvelteKit/Supabase — which is correct going forward?)
 Final site name and domain
 Legal operator/entity for the business
 Public support email
 Privacy contact
 Appeals channel (for moderation disputes)
 Should merchant verification stay manual, or get a real upload workflow?
 Are report PDFs actually necessary, or can that be dropped for simplicity?
 SMS provider for phone verification
 Expected beta size (how many invited users initially?)
 Backup retention period and acceptable downtime
 Should production stay permanently invite-only, or is public launch the eventual goal?
 Are chat attachments needed for v1, or can they wait?
 Is public search-engine indexing ever desired, and if so, when?

(As each is answered, move it to a "Decisions Made" section below with the answer and date.)

5. Decisions made

(Move answered items here, with date and reasoning, so the "why" isn't lost later.)

Example format: [Date] — Question: ... Decision: ... Reasoning: ...
6. Standing rules for any agent working on this repo

These apply regardless of which phase is active.

Read this file and the latest audit/status file before doing anything else, every session.
Never touch files outside the current phase's stated scope without explicit approval. If something outside scope is discovered, report it — don't fix it inline.
Never commit real secrets, even as examples. .env.example values must always be empty or obviously fake.
Show a plan before making changes; wait for approval before executing, unless the owner has explicitly pre-approved a specific scoped batch (as with Phase 1).
After any phase, save/update a findings or status file in docs/ — don't let outcomes live only in chat history.
If a subagent or tool reports something surprising, verify it against the real repo before including it in a finding. (This project has already caught two false positives this way — keep doing that.)
Flag, don't silently skip, anything that seems like a business/legal decision rather than a code decision — add it to the Open Questions list above instead of guessing.
If context has compacted more than once in a session, say so and suggest starting a fresh session once the current step is done — don't push through degraded context on faith.
7. How to start any new session

Copy/paste this as your opening message to Hermes:

Read docs/MASTER-PLAN.md and the most recent file in docs/ matching AUDIT-*.md or PROJECT-STATUS.md before doing anything else. Tell me what phase we're on and what's currently blocking. Then wait for my instructions.

8. File index (update as new reference docs are created)
docs/CONCEPT.md — original business concept
docs/MASTER-PLAN.md — this file
docs/AUDIT-2026-08-02.md — full initial audit findings
docs/PROJECT-STATUS.md — living short-form status, updated after every phase