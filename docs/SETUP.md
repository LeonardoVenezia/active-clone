# Active-clone deployment checklist

Based on vercel-labs/workflow-builder-template, commit 24fb0fd4524ee10491ea6b73f6df94137ecbf9e1. Apache-2.0 LICENSE retained.

## Required for auth and persistence

- Import LeonardoVenezia/active-clone into the intended Vercel personal/team account. Do not enable paid services without approval.
- Connect a PostgreSQL database. Set DATABASE_URL. Production build runs Drizzle migrations; use a separate database for preview/test to avoid touching production.
- Set BETTER_AUTH_SECRET (secure random secret), BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL to the deployed origin.
- Set NEXT_PUBLIC_AUTH_PROVIDERS=email for the first stage.
- Set INTEGRATION_ENCRYPTION_KEY to 32 cryptographically random bytes encoded as 64 hex characters.
- Set RESEND_API_KEY and RESEND_FROM_EMAIL to an approved, verified sender. Password reset fails closed without email delivery config.

## Later stages

- AI_GATEWAY_API_KEY or OPENAI_API_KEY for chat generation. Model usage can cost money. Set limits before tests.
- COMPOSIO_API_KEY for managed connections/actions. The Composio adapter is not implemented in this first auth patch. Verify actual plan limits and selected apps/actions before depending on them.
- Workflow SDK Local World is development-only; verify Vercel execution backend and deployment configuration before claiming durable runs.

Secrets belong in the hosting environment, not code, commits, logs or chat. The app includes optional OAuth/provider code inherited from the template; those are not configured by default.

## Verification status

- Scaffold downloaded and generated plugin registry inspected.
- Password reset UI and Resend callback added; must be tested against PostgreSQL, a real verified sender and the deployed origin.
- Full template features are inherited code, not yet QA-approved as Active-clone features.
