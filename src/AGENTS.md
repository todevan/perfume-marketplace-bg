# src AGENTS.md

## Scope
This folder contains the application runtime and user-facing layers.

## Expectations
- Keep route files thin. Authorization, request validation and business rules should live in server modules or route handlers.
- Prefer server-side data access over direct client writes. Browser code should not bypass the existing server action and repository boundaries.
- Keep UI components focused on rendering and user interaction. Move workflow enforcement into services and domain logic.
- Use the contracts under src/lib/contracts for shared validation and DTO shapes.

## Watchpoints
Regular-user admission uses public email/password registration, email confirmation, and onboarding. Do not introduce invitation, waiting-list, phone verification, or SMS OTP as normal-user activation/listing/offer requirements. Staff/admin MFA remains mandatory.
- Uploads, evidence and moderation paths must remain privacy-preserving and validated.
- Changes to routes should consider SSR, layout loading and the current route guards.
