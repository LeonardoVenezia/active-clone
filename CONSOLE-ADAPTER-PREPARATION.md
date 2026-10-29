# Inert provider and mail adapters

These factories are not imported by production routes, workers, callbacks or runtime configuration. They perform no calls on import or construction. All tests pass an in-memory HTTP function; no external request is made.

## Existing source grounding

- Mail already uses Resend in lib/email.ts. The console transport mirrors its text-email shape, with an explicit enable input and idempotency key. It does not load existing keys or run a worker.
- Native Tiendanube and Mercado Libre OAuth callback routes exist in app/api/integrations. Console factories use the same token endpoints and field names but require the expected existing provider identity. A reconnect must update the existing encrypted integration, not create a new one or register new webhooks.
- Mercado Libre supports an optional PKCE verifier, carried in the body only. The future initiation/callback flow must persist/bind it safely; this preparation does not implement that route.

## Current live inventory, read-only 2026-10-29 16:28 ART

Production aggregate only: mercadopago 3, mercadolibre 1, enviopack 1, zipnova 1. No Tiendanube or Resend integration row appeared in this result. This is not evidence that tokens work, belong to the future pilot, or that mail env configuration is absent. No credential content was retrieved.

Mercado Libre is therefore an existing integration-type candidate for later pilot selection, not a selected or approved account. Tiendanube adapter is preparation based on existing code, not evidence of a currently connected shop. Mercado Pago is also present but its adapter remains to be implemented; payments-related scopes make a read-only/manual no-effect pilot preferable.

## Deliberate limits

- No email sent. A response with an email ID means accepted by provider, not delivered. Timeouts, malformed successes and 5xx are unknown, never automatic retries. Provider idempotency lasts only 24 hours; a future worker needs durable claims/reconciliation beyond that window.
- No consent or provider exchange performed. A successful token exchange can itself replace or invalidate prior tokens, even if no business action runs. It needs the selected account and approval.
- No real callback route or initiator wired, no background worker, no webhook handling for delivery receipts. These remain implementation work, not completed integrations.
- Existing reconnect contract supplies tenant/actor/ticket/expiry/version guards. Its future orchestrator must obtain expected provider identity from the verified existing encrypted integration, never browser JSON.

## Current official references verified

- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/docs/api-reference/emails
- https://tiendanube.github.io/api-documentation/authentication
- https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion
