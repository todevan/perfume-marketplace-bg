# Hosted Proof Contract

Hosted proof is conditional evidence for an exact candidate, not current production
truth. Security and protected-action boundaries remain canonical in
[`../SECURITY.md`](../SECURITY.md).

## Transaction envelope

One owner authorization binds the whole safe external transaction: issue; exact
providers, environment, organization, and account; free/maximum spend; disposable
and preserved resources; maximum stateful attempts; expected human actions; cleanup
scope; forbidden resources/environments; and stop conditions. Ordinary engineering
repair within that envelope requires no new authorization. A materially broader
provider action does.

Instantiate [`../templates/HOSTED-TRANSACTION.md`](../templates/HOSTED-TRANSACTION.md)
as a private mode-600 manifest outside the repository.

## Manifest state machine

```text
planned
→ preflight_verified
→ resources_creating
→ resources_ready
→ awaiting_human
→ proof_running
→ proof_failed_safe | proof_passed
→ cleanup_pending
→ cleanup_verified
```

Persist intended mutation before execution. Perform exact readback after every
mutation and advance only after durable evidence. Never retry an uncertain transport
or provider outcome automatically. Cleanup is idempotent, exact, and
provenance-bound; it never uses wildcard or unknown-resource deletion. Recovery is an
explicit boundary rather than an automatic cleanup fallback. A terminal manifest has
no pending mutation, and its durable sanitized receipt contains no secret material.

## Capability and schema preflight

Before freeze or provisioning, verify:

- API authentication and exact target identity, account, region, and plan/cost;
- provider CLI/runtime version;
- required payload IDs, statuses, and timestamp fields;
- inbox delivery and deletion semantics;
- CAPTCHA domain/action behavior;
- runner support for documented equivalent fields without weaker assertions.

For email timestamps, allow the preflight-verified equivalent fields and require
every present timestamp to fall inside the exact run window. A single assumed field
such as `received_at` is not a stable provider contract.

## One transaction fixture

Run ID, synthetic identity, city input, expected display value, recipient, allowed
origin, and timing window come from one fixture. Helpers and assertions consume that
fixture; they do not independently normalize or restate expected values.

## Human browser boundary

Use one persistent, dedicated, transaction-bound visible browser profile outside the
repository. Before handoff, prepare the exact page and transaction; bind form values
to the manifest; ensure the context survives; disable or redact screenshot, video,
and trace capture on credential forms; identify the immediate post-CAPTCHA action;
and eliminate navigation or reload that would invalidate a token.

Ask the human for exactly one action. Read the challenge state immediately and
continue in the same context. Request repetition only when live evidence proves the
token was not submitted and no side effect occurred. Never capture passwords,
confirmation tokens, recovery links, synthetic credentials, or private email content
in screenshots.

## Auth journey matrix

For auth/onboarding changes, prove each applicable seam:

1. forged CAPTCHA denied with zero side effects;
2. one real registration and exact confirmation delivery;
3. unconfirmed marketplace denial and sanitized confirmation redirect;
4. exact onboarding fields/normalization and required consent events;
5. active membership, explicit sign-out, fresh normal login, and protected access;
6. confirmation replay denial;
7. CAPTCHA recovery with exact delivery and account non-enumeration;
8. hostile callback/token denial;
9. exact cleanup and independent absence readback.

Local tests mirror hosted seams as closely as possible. Hosted Playwright
configuration must fail loudly when it discovers zero proof tests.

## Diagnostics and failure

A generic user-safe `500` is not sufficient diagnostic evidence. Use secret-safe
correlation/stage markers for provider exchange completion, authenticated-user read,
admission start/completion, profile/MFA/context reads, redirect selection, and server
failure boundary. Never log credentials, tokens, provider secrets, private email
content, or raw profiles.

Classify failure before action. No blind retry follows a stateful failure. A failed
journey ends with `proof_failed_safe` and exact cleanup, not a false PASS.

The proven code under [`scripts/issue22-hosted`](../../../scripts/issue22-hosted/) is
historical/reference operator code. Preserve its behavior. Reuse its contract through
templates or extract only obviously pure, already-tested primitives; defer broader
provider-adapter refactoring when it would create an R2 surface.
