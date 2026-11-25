# ADR-0004: Bidirectional n8n JWT & Service-Token Contract

**Status:** Accepted

## Context

LendLoop delegates transactional email notifications (Workflow 1) and daily `Overdue` reminders (Workflow 2) to n8n. Webhook endpoints exposed over HTTP must resist spoofing, body tampering, replay attacks, and duplicate email sends on retries, while exported workflow JSON committed to Git must remain free of real secrets, URLs, and credential IDs (and remain compatible with n8n Cloud Starter where `$env`/`$vars` are restricted).

## Decision

1. **Convex → n8n (Workflow 1 — `01-loan-notification.json`):**
   - Domain mutations insert a `pending` `automationActivities` row (outbox + idempotency store + `Loan` timeline) and schedule an internal action.
   - The action computes `bodySha256` over the exact serialized JSON string and signs a 60-second HS256 JWT (`iss: "convex"`, `aud: "n8n-automation"`, `jti: eventId`, `bodySha256`) via Web Crypto.
   - n8n verifies the JWT with encrypted `jwtAuth` credentials, validates `iss`/`aud`/`bodySha256` against the raw body, deduplicates on `jti` via `Remove Duplicates`, sends SMTP, and terminates every branch with a synchronous `Respond to Webhook` (`200` `smtp_accepted`/`duplicate` → Convex `sent`).
   - Convex retries transient `429`/`5xx`/network errors up to 3 total attempts with exponential backoff + ±20% jitter, failing immediately on `400`/`401`/`403`.
2. **n8n → Convex (Workflow 2 — `02-overdue-reminders.json`):**
   - Daily at `09:00 UTC`, n8n authenticates via encrypted `httpHeaderAuth` (`X-N8N-Service-Token`), verified in Convex using constant-time `crypto.subtle.verify` supporting `N8N_SERVICE_TOKEN_PREVIOUS` for zero-downtime rotation.
   - n8n cursor-paginates `GET /api/n8n/overdue-loans` (batches of 100, pre-filtered against today's `overdue_reminder:<loanId>:<YYYY-MM-DD>` key), sends per-loan SMTP with `retryOnFail` + `continueErrorOutput`, and acknowledges idempotently via `POST /api/n8n/overdue-reminders/ack` with `X-Idempotency-Key`.
3. **Error handling & export hygiene:**
   - Dedicated Error Workflow (`03-error-handler.json`) emails sanitized ops alerts with zero `Borrower`/`Lender` PII.
   - Exported workflows replace real IDs with `__REPLACE_ON_IMPORT__`, store non-secret config in a `Config` Set node, and are gated in CI by `pnpm check:workflows`.

## Consequences

- Tampered payloads, forged requests, and replayed deliveries are rejected or deduplicated cleanly, verified live in CI against real n8n + Mailpit containers.
- Single-loan SMTP failures never abort a daily `Overdue` batch.
- Upgrading from HS256 to RS256/JWKS is a localized change in `convex/automation/crypto.ts` and the n8n JWT credential.
