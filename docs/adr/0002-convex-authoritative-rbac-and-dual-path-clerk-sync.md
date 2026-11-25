# ADR-0002: Convex-Authoritative RBAC & Dual-Path Clerk Sync

**Status:** Accepted

## Context

LendLoop uses Clerk for authentication and Convex for application state. Storing platform `role` (`user` | `admin`) or `trustedLender` solely in Clerk JWT custom claims introduces token staleness (up to 60s), risks session-cookie bloat, and couples authorization enforcement to external identity metadata. Conversely, relying solely on Clerk webhooks for user creation breaks local development without public tunnels.

## Decision

1. **Convex-authoritative RBAC:** `role` and display-only `trustedLender` live exclusively in the Convex `users` table and are enforced on every query and mutation through a central guard module (`convex/lib/authz.ts`: `requireIdentity`, `requireRole("admin")`, `requireListingLender`, `requireLoanParticipant`).
2. **Out-of-band role promotion:** Changing `role` (`user` ↔ `admin`) is restricted exclusively to an internal Convex mutation (`internal.users.mutations.setUserRole`) invoked via CLI or dashboard, plus an optional `BOOTSTRAP_ADMIN_EMAILS` env var checked only on initial user creation and left unset in `prod`.
3. **Dual-path Clerk → Convex sync:**
   - **Authenticated shell path:** `syncCurrentUser` runs idempotently on login, reading identity strictly from the verified JWT (`ctx.auth.getUserIdentity()`) — never client arguments.
   - **Webhook path:** `POST /webhooks/clerk` verifies Svix signatures (`CLERK_WEBHOOK_SECRET`) to handle `user.updated` (updating `displayName`/`email` without touching `role` or `trustedLender`) and `user.deleted` (anonymizing the `User` tombstone, archiving owned `Listing`s and deleting their photos, and cleaning up `pending` `Loan`s while preserving historical `Loan` and `Audit Log` integrity).

## Consequences

- First-time login works immediately in local and CI environments with zero webhook tunnels.
- Role revocations and `Trusted Lender` changes take effect on the very next Convex transaction with zero JWT staleness.
- Every governance mutation atomically records a non-PII `Audit Log` entry in the same Convex transaction.
