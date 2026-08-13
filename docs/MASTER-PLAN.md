Perfume Marketplace - Master Plan

Purpose of this document: This is the single source of truth for the project. Any AI agent (Hermes or otherwise) working on this codebase should read this file first, every session, before doing anything else. It exists because agent sessions compact, reset, and drift - this file doesn't.

Owner: [Tedi] - the only person who can approve business/legal decisions and authorize new phases of work.

Last updated: 2026-08-02

1. What this project is

A Bulgarian online marketplace for buying, selling, and exchanging new, pre-owned, and collectible perfumes. Private sellers, collectors, and verified merchants publish structured listings; buyers discover them through a catalogue and filters; both sides negotiate through an internal chat and structured offers; payment and delivery happen off-platform. The platform does not process payments, hold inventory, or guarantee authenticity - it provides structure, search, trust signals, and moderation.

Full concept document: docs/CONCEPT.md (save the original concept doc here if not already saved)

Target stack (confirm this matches reality - see Open Questions #1): SvelteKit, TypeScript, Supabase (Postgres + RLS), Cloudflare Workers/Pages, Playwright.

Current stage: pre-launch development with open email-and-password registration. Not yet production-ready.

2. Current state (living summary - update this section as phases complete)

Keep this section short. Full detail lives in the dated audit files below. This is just "where are we right now."

Last full audit: docs/AUDIT-2026-08-02.md
Phase currently active: Phase 2 - security hardening and hosted integration tests
Phases completed: Phase 0 (credential rotation - done manually by owner, Aug 2 2026), Phase 1 (green local baseline)
Known blockers right now: hosted evidence acceptance, owner-approved messaging/moderation-evidence/blocking and retention semantics, and real multi-session concurrency tests; hosted staging activation remains blocked
Branch under active work: main (local changes are not committed or pushed)

(Update this block every time a phase completes or a new blocker is found - this is the 30-second version of project status.)

3. The phase plan

This is the order of work. Do not skip ahead or combine phases unless explicitly told to. Each phase has a goal and an exit condition - don't call a phase "done" until its exit condition is actually met.

Phase	Goal	Exit condition
0	Security containment	Exposed credential rotated, removed from files, activity reviewed - DONE
1	Restore a green, buildable branch	All local checks + PR CI pass
2	Security hardening + hosted integration tests	Security boundaries hold when bypassing the UI, not just the app
3	Activate required staging providers	A real invited seller and buyer can complete the full lifecycle in staging
4	Legal and privacy completion	No placeholder legal content; data export/deletion implemented and tested
5	UX completion and regression protection	Dead controls removed/implemented; key flows have test coverage
6	Backup, monitoring, production deployment	Production can be deployed, monitored, and restored predictably
7	Post-launch maintenance	Ongoing - not a one-time exit condition

Full detail on each phase's specific tasks: see docs/AUDIT-2026-08-02.md, section 9.

4. Open questions - only the owner can answer these

These block later phases. Answer them whenever you're ready - doesn't need to be all at once.

 Confirm actual tech stack matches this doc (concept doc said Next.js/Prisma; real repo uses SvelteKit/Supabase - which is correct going forward?)
 Final site name and domain
 Legal operator/entity for the business
 Public support email
 Privacy contact
 Appeals channel (for moderation disputes)
 Should merchant verification stay manual, or get a real upload workflow?

 Expected beta size (how many invited users initially?)
 Backup retention period and acceptable downtime
 Are chat attachments needed for v1, or can they wait?
 Is public search-engine indexing ever desired, and if so, when?
 What message policy should Phase 2 enforce: edit deadline, irreversible deletion behavior, immutable revision/snapshot scope, and moderation retention/legal-hold duration?
 Should blocking be a unilateral inbound-contact prohibition, mutual conversation closure, or local mute/hide; and what historical chat/deal access remains after blocking?
 Should expired offers remain visibly distinct from seller-declined and buyer-withdrawn offers in user and support history?
 Should transactional-email provider 4xx failures be acknowledged as terminal after durable ledger failure, or retried by the webhook/operator workflow; which specific statuses are considered transient?
 Should reports continue to accept up to four 10 MiB images in one Worker request, use a lower aggregate request limit, or move evidence to direct quarantine uploads to reduce peak isolate memory?

(As each is answered, move it to a "Decisions Made" section below with the answer and date.)

5. Decisions made

(Move answered items here, with date and reasoning, so the "why" isn't lost later.)

Example format: [Date] - Question: ... Decision: ... Reasoning: ...

2026-08-02 - Question: Should registration remain invite-only and should regular users verify a phone before account activation or sensitive marketplace actions? Decision: No. The owner requires standard public email-and-password signup and login, with no invitation restriction and no phone-number or SMS OTP verification for regular-user activation or marketplace actions. Email confirmation, existing password rules, secure-cookie sessions, legal onboarding/consents, suspension and moderation controls remain; staff/admin MFA remains separate and mandatory. Reasoning: During the current development stage the owner wants the simplest regular-user authentication flow and does not want invites or phone verification to block testing and use. Existing RLS policies and unrelated authorization/moderation behavior must remain unchanged.

2026-08-02 - Question: Are PDF report attachments required before launch, and how should report evidence be handled without a configured document scanner? Decision: Report evidence is images-only for now. Accepted images must be decoded and re-encoded through the trusted image processor before final storage; PDFs and other document formats are rejected until a dedicated malware/PDF scanning provider exists. Text-only reports remain available when image processing is unavailable. Reasoning: This closes the active-content and malformed-file risk without silently storing unscanned documents or blocking users from filing a report.
6. Standing rules for any agent working on this repo

These apply regardless of which phase is active.

Read this file and the latest audit/status file before doing anything else, every session.
Never touch files outside the current phase's stated scope without explicit approval. If something outside scope is discovered, report it - don't fix it inline.
Never commit real secrets, even as examples. .env.example values must always be empty or obviously fake.
Show a plan before making changes; wait for approval before executing, unless the owner has explicitly pre-approved a specific scoped batch (as with Phase 1).
After any phase, save/update a findings or status file in docs/ - don't let outcomes live only in chat history.
If a subagent or tool reports something surprising, verify it against the real repo before including it in a finding. (This project has already caught two false positives this way - keep doing that.)
Flag, don't silently skip, anything that seems like a business/legal decision rather than a code decision - add it to the Open Questions list above instead of guessing.
If context has compacted more than once in a session, say so and suggest starting a fresh session once the current step is done - don't push through degraded context on faith.
7. How to start any new session

Copy/paste this as your opening message to Hermes:

Read docs/MASTER-PLAN.md and the most recent file in docs/ matching AUDIT-*.md or PROJECT-STATUS.md before doing anything else. Tell me what phase we're on and what's currently blocking. Then wait for my instructions.

8. File index (update as new reference docs are created)
docs/CONCEPT.md - original business concept
docs/MASTER-PLAN.md - this file
docs/AUDIT-2026-08-02.md - full initial audit findings
docs/PROJECT-STATUS.md - living short-form status, updated after every phase

## Durable owner-authored decisions preserved during reconciliation

- The owner is the final authority for product, business, legal, privacy, and protected production decisions; ordinary reversible implementation details remain within the repository autonomy rules.
- The marketplace is an off-platform transaction coordinator: it does not process marketplace payments, hold inventory, or guarantee authenticity.
- Verified-merchant status is a trust signal and must not become a paid-plan, VIP, subscription, or boost benefit.
- The MVP remains limited to supported physical perfume listing formats and truthful backend-supported search/filter/pagination behavior. Do not add decants, arbitrary bundles, designer/set expansion, scraped catalogue content, or unsupported relevance claims without an explicit decision.
- Backup and recovery evidence must cover both PostgreSQL state and compatible finalized sanitized Storage objects. A database-only backup is not complete marketplace recovery evidence.
- Incident severity does not authorize protected or destructive mutations. Hosted-provider changes, production mutation, credential changes, and destructive recovery require the applicable gate and Human Gate.
