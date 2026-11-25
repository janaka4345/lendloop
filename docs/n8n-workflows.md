# n8n Automation Workflows Guide

LendLoop uses three sanitized, version-controlled n8n workflows under `n8n/workflows/` to handle transactional `Loan` notifications, daily `Overdue` reminders, and operational error alerting.

## Workflow Inventory

| File                                      | Purpose                                                                                                                   | Trigger                                    | Auth                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `n8n/workflows/01-loan-notification.json` | Sends transactional emails for `loan_requested`, `loan_approved`, `loan_declined`, `loan_cancelled`, and `loan_returned`  | `POST /webhook/lendloop-loan-notification` | Inbound 60s HS256 JWT (`iss: "convex"`, `aud: "n8n-automation"`, `jti`, `bodySha256`) |
| `n8n/workflows/02-overdue-reminders.json` | Polls overdue `Loan`s in cursor-paginated batches of 100, sends at most one reminder per UTC day, and acks back to Convex | Schedule (`09:00 UTC` daily)               | Outbound `X-N8N-Service-Token` + `X-Idempotency-Key`                                  |
| `n8n/workflows/03-error-handler.json`     | Catches unhandled crashes in Workflows 1 & 2 and emails a sanitized ops alert containing zero `Borrower`/`Lender` PII     | n8n Error Trigger                          | SMTP credential                                                                       |

## Security & Reliability Contract

1. **Convex → n8n (Workflow 1):**
   - Convex serializes the JSON payload, computes `bodySha256`, mints a 60s HS256 JWT (`jti = eventId`), and POSTs to `N8N_WEBHOOK_URL`.
   - Workflow 1 verifies the JWT signature using encrypted `jwtAuth` credentials, recomputes SHA-256 over the raw request body to reject tampering, deduplicates on `jti` via `Remove Duplicates`, sends SMTP, and always returns a synchronous `Respond to Webhook` (`200 { status: "smtp_accepted" | "duplicate" }` or explicit `4xx`/`5xx`).
   - Convex retries transient `429`/`5xx`/network failures up to **3 total attempts** with bounded exponential backoff + ±20% jitter, failing immediately on `400`/`401`/`403`.
2. **n8n → Convex (Workflow 2):**
   - Calls `GET <convexBaseUrl>/api/n8n/overdue-loans?cursor=...&limit=100` with `X-N8N-Service-Token`. Convex verifies the token in constant time against `N8N_SERVICE_TOKEN` and optional `N8N_SERVICE_TOKEN_PREVIOUS`.
   - Each SMTP and HTTP node enables `retryOnFail` (3 tries, 5s wait) and `continueErrorOutput` so one failing recipient never aborts the batch.
   - After SMTP acceptance, n8n calls `POST <convexBaseUrl>/api/n8n/overdue-reminders/ack` with `X-Idempotency-Key: overdue_reminder:<loanId>:<YYYY-MM-DD>`.

## Local Development (Zero Manual Setup)

`docker compose up` runs the one-shot `n8n-init` container (`n8n/init/bootstrap.mjs`), which:

1. Creates local encrypted credentials (`LendLoop SMTP` pointing to `mailpit:1025`, `LendLoop Convex JWT`, and `LendLoop Convex Service Token`).
2. Replaces all `__REPLACE_ON_IMPORT__` credential and `errorWorkflow` placeholders in a temporary copy of the 3 workflow JSON files.
3. Imports all 3 workflows into n8n and activates Workflows 1 & 2.

Inspect delivered emails in Mailpit at `http://localhost:8025` and workflow executions in n8n at `http://localhost:5678`.

## Cloud / n8n Cloud Starter Import

Because n8n Cloud Starter restricts `$env` and `$vars`, non-secret runtime settings live in a dedicated **`Config` Set node** inside each workflow.

1. In n8n, create three credentials:
   - **SMTP** (`LendLoop SMTP`) — your transactional SMTP provider.
   - **JWT Auth** (`LendLoop Convex JWT`) — Key Type: Passphrase, Algorithm: `HS256`, Secret: matches Convex `N8N_JWT_SECRET`.
   - **Header Auth** (`LendLoop Convex Service Token`) — Name: `X-N8N-Service-Token`, Value: matches Convex `N8N_SERVICE_TOKEN`.
2. Import `03-error-handler.json` first, bind the SMTP credential, and update its `Config` node (`opsAlertEmail`, `fromEmail`).
3. Import `01-loan-notification.json` and `02-overdue-reminders.json`, bind credentials, set **Workflow Settings → Error Workflow** to `LendLoop - Error Handler`, and update their `Config` nodes (`convexBaseUrl`, `fromEmail`, environment webhook path `/webhook/<env>/lendloop-loan-notification` if sharing an n8n instance).
4. Activate Workflows 1 & 2.

## Zero-Downtime Secret Rotation

### Rotating `N8N_SERVICE_TOKEN` (n8n → Convex)

1. Generate a new 32+ byte random token (`NEW_TOKEN`).
2. In Convex, copy the current token to `N8N_SERVICE_TOKEN_PREVIOUS` and set `N8N_SERVICE_TOKEN` to `NEW_TOKEN`.
3. Update the `LendLoop Convex Service Token` credential in n8n to `NEW_TOKEN`.
4. Verify Workflow 2 executes cleanly, then unset `N8N_SERVICE_TOKEN_PREVIOUS` in Convex.

### Rotating `N8N_JWT_SECRET` (Convex → n8n)

1. Generate a new 32+ byte random secret.
2. Update the `LendLoop Convex JWT` credential in n8n and `N8N_JWT_SECRET` in Convex during a quiet window (in-flight Convex actions automatically retry up to 3 times with backoff).

## Workflow Export Hygiene

Before committing any exported workflow JSON changes:

1. Replace all real credential IDs and `settings.errorWorkflow` IDs with `__REPLACE_ON_IMPORT__`.
2. Ensure `Config` Set nodes contain only safe local defaults (never real domains, emails, or secrets).
3. Run `pnpm check:workflows` (also enforced in CI).
