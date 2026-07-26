# Production beta implementation decisions

- Preserve the existing Svelte UI and replace demo data through server-side DTO/repository boundaries.
- Normal user queries use a request-scoped Supabase client so Row Level Security remains authoritative.
- Privileged credentials are restricted to invitations, upload finalization, scheduled operations and audited moderation services.
- Routes fail closed when production mode is enabled but Supabase configuration is incomplete.
- Existing migrations `001` and `002` remain immutable; all hardening is forward-only.
- Chat is text-only and created by accepting a structured offer.
- Billing and every paid feature remain disabled for the closed beta.
- No production deployment or third-party account mutation occurs without user-provided credentials and confirmation.
