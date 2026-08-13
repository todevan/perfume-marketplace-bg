# Perfume Marketplace — Master Plan

## Purpose and authority

This document defines durable product direction, broad roadmap phases, owner-controlled business decisions, and long-lived project constraints. It is not a living operational log and does not prove hosted or release state.

Use this authority order:

```text
AGENTS.md and explicit owner instructions
        ↓
authoritative project and domain documentation
        ↓
PROJECT-STATUS and applicable launch/gate evidence
        ↓
current GitHub issue or explicitly authorized scope
        ↓
skill-assisted reasoning and execution
```

For current implementation and release state, use `docs/PROJECT-STATUS.md`, applicable launch/gate documentation, GitHub Issues, and verified repository/provider evidence. For agent execution policy, use the applicable documents under `docs/agents/`.

Owner: **Tedi**. The owner retains product, business, legal, privacy, high-risk merge, and protected production authority defined by the repository Human Gates. Ordinary reversible engineering decisions do not require routine owner approval.

Last durable review: 2026-08-13.

1. What this project is

A Bulgarian online marketplace for buying, selling, and exchanging new, pre-owned, and collectible perfumes. Private sellers, collectors, and verified merchants publish structured listings; buyers discover them through a catalogue and filters; both sides negotiate through an internal chat and structured offers; payment and delivery happen off-platform. The platform does not process payments, hold inventory, or guarantee authenticity - it provides structure, search, trust signals, and moderation.

The durable concept is defined by this document together with `docs/ARCHITECTURE.md`, `docs/BUSINESS-MODEL.md`, and applicable product specifications. A separate `docs/CONCEPT.md` is not required.

The active stack is SvelteKit, TypeScript, Supabase PostgreSQL/Auth/private Storage/Realtime, Cloudflare Workers, and Playwright. `docs/ARCHITECTURE.md` is the architecture authority.

Current stage: pre-launch development with open email-and-password registration. Not yet production-ready.

2. Operational state

Operational phase, gate, blocker, merged-SHA, deployment, and provider claims belong in `docs/PROJECT-STATUS.md` or the applicable gate evidence. Do not copy that volatile state into this durable plan or infer hosted state from roadmap text.

3. The phase plan

This is the order of work. Do not skip ahead or combine phases unless explicitly told to. Each phase has a goal and an exit condition - don't call a phase "done" until its exit condition is actually met.

Phase	Goal	Exit condition
0	Security containment	Exposed credential rotated, removed from files, and relevant activity reviewed
1	Restore a green, buildable branch	All local checks + PR CI pass
2	Security hardening + hosted integration tests	Security boundaries hold when bypassing the UI, not just the app
3	Activate required staging providers	A real or controlled synthetic seller and buyer can complete the public email/password lifecycle in staging
4	Legal and privacy completion	No placeholder legal content; data export/deletion implemented and tested
5	UX completion and regression protection	Dead controls removed/implemented; key flows have test coverage
6	Backup, monitoring, production deployment	Production can be deployed, monitored, and restored predictably
7	Post-launch maintenance	Ongoing - not a one-time exit condition

Full detail on each phase's specific tasks: see docs/AUDIT-2026-08-02.md, section 9.

4. Open questions - only the owner can answer these

These block later phases. Answer them whenever you're ready - doesn't need to be all at once.

 Final site name and domain
 Legal operator/entity for the business
 Public support email
 Privacy contact
 Appeals channel (for moderation disputes)
 Should merchant verification stay manual, or get a real upload workflow?

 Expected initial beta size
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

- Read the applicable repository, product, status, issue, and gate authority before substantial work.
- Stay inside the current issue, phase, and named-gate scope; record independent work in the GitHub Issues queue.
- Never commit secrets. Examples must be empty, explicitly fake, or provider-documented safe placeholders.
- Continue autonomously through ordinary reversible engineering. Stop only at H1–H6 or another explicit protected boundary.
- Treat Superpowers as the primary process owner, Matt Pocock skills as engineering-depth helpers, and ECC/platform skills as narrow specialists. Do not run competing end-to-end workflows.
- Verify surprising tool or subagent claims against repository/provider evidence.
- Use repository risk rules: R0/R1 may proceed through verified review/CI boundaries, R2 stops at H3 before merge, and R3 actions remain protected.
- Preserve significant audit, incident, release, hosted-acceptance, or architecture evidence in its authoritative durable location. Do not create a result document for every routine task.

7. Session start

Follow `AGENTS.md` and the documents it routes to. Establish current repository truth, select authorized work through the GitHub Issues frontier when the user has not supplied a narrower task, classify risk, and begin automatically unless a Human Gate already applies.

8. File index

- `docs/MASTER-PLAN.md` — durable product direction, roadmap, and owner decisions.
- `docs/PROJECT-STATUS.md` — living operational state.
- `docs/ARCHITECTURE.md` — intended system structure and security boundaries.
- `docs/LAUNCH-GATES.md` — readiness conditions and launch boundaries.
- `docs/AUDIT-2026-08-02.md` — historical audit evidence.
- `docs/agents/` — autonomy, execution, queue, skill-routing, and Human-Gate policy.
