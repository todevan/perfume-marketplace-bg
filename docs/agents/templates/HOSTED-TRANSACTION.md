# Hosted Transaction Manifest Template

> Instantiate outside the repository as a private mode-600 file. This template never
> contains credentials, tokens, links, private emails, or provider response bodies.

## Envelope

- **Issue:** `#N`
- **Candidate SHA/tree:** `<exact identities>`
- **Deployment identity:** `<exact non-secret identity>`
- **Run ID/window:** `<ID>` / `<start>` → `<end>`
- **Allowed providers/targets:** `<provider, environment, organization/account, region>`
- **Cost limit:** `<free or exact maximum>`
- **Disposable resources:** `<exact resource classes>`
- **Preserved/forbidden resources:** `<exact boundaries>`
- **Maximum stateful attempts:** `<number>`
- **Expected human action:** `<one exact CAPTCHA/credential/protected boundary or none>`
- **Cleanup scope:** `<exact owned resources and absence readbacks>`
- **Stop conditions:** `<exact conditions>`

## Fixture

- **Synthetic identity reference:** `<secret-store/ephemeral reference, never value>`
- **City input / expected display:** `<one-source pair>`
- **Recipient reference:** `<non-secret reference>`
- **Allowed origin:** `<origin>`
- **Timing window:** `<exact bounds>`

## Preflight

- [ ] API authentication and target identity verified.
- [ ] Account, region, plan, and cost limit verified.
- [ ] Provider/runtime versions recorded.
- [ ] Required ID, status, and equivalent timestamp fields verified.
- [ ] Inbox delivery/deletion and CAPTCHA domain/action semantics verified.
- [ ] Nonzero proof-test discovery verified.
- [ ] Capture is disabled/redacted on sensitive browser forms.

## State

- **Current state:** `planned`
- **Pending intended mutation:** `none`
- **Last durable evidence:** `<sanitized reference>`
- **Next exact action:** `<one action>`

Allowed transitions:

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

Before every mutation, persist its exact intent as pending. After exact readback,
record sanitized durable evidence, clear the pending mutation, and advance once.
Uncertain outcomes stop for fresh inspection; they are never retried blindly.

## Journey and cleanup

- **Applicable journey rows:** `<matrix items from reference/HOSTED-PROOF.md>`
- **Observed result:** `<PASS or proof_failed_safe with exact boundary>`
- **Owned cleanup targets:** `<exact provenance-bound list>`
- **Cleanup readback:** `<independent sanitized absence evidence>`
- **Terminal state:** `<cleanup_verified only when no mutation remains pending>`
