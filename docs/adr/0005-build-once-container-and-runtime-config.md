# ADR-0005: Build-Once Container & Runtime Configuration

**Status:** Accepted

## Context

Baking `NEXT_PUBLIC_*` variables into Next.js client bundles forces separate container builds per environment (`dev`, `qa`, `staging`, `prod`), invalidating the guarantee that the exact artifact tested in CI and `qa` is what runs in `prod`. Static CSP headers also break when Clerk, Convex, or Sentry origins differ by environment.

## Decision

1. **Zero `NEXT_PUBLIC_*` baking:** ESLint `no-restricted-syntax` bans all `process.env.NEXT_PUBLIC_*` reads across `src/**/*.{ts,tsx}`.
2. **Runtime config injection:** `RootLayout` (`force-dynamic`) validates server `process.env` via `validateRuntimeConfig()` (`src/lib/runtime-config.ts`) and passes non-secret `PublicRuntimeConfig` (`appUrl`, `convexUrl`, `clerkPublishableKey`, `sentryDsn`, `environment`) to `AppProviders`. `GET /api/config` exposes the same payload with `Cache-Control: no-store`.
3. **Runtime-derived CSP & security headers:** Next.js middleware computes OWASP headers and a runtime CSP from `CLERK_PUBLISHABLE_KEY` / `CLERK_FRONTEND_API_URL`, `CONVEX_URL` (`https:` + `wss:`), and optional `SENTRY_DSN` on every request.
4. **Runtime-optional Sentry:** Server, edge, and browser Sentry initialization activate only when `SENTRY_DSN` is present at runtime (`sendDefaultPii: false`, scrubbing headers, cookies, tokens, and emails via `src/lib/sentry.ts`) and remain a clean no-op when unset.
5. **Hardened standalone image & probes:** Multi-stage digest-pinned Node 22 Alpine image (`output: "standalone"`), stripped of `npm`/`yarn`/`corepack`, running as non-root `USER 10001` with read-only root filesystem (`tmpfs: [/tmp]`, `cap_drop: [ALL]`, `no-new-privileges:true`). `GET /healthz` returns unconditional `200 { status: "ok" }` for liveness; `GET /readyz` validates runtime env structure with zero network calls.

## Consequences

- One immutable container image built on `main` is scanned once with Grype and promoted unchanged by `@sha256:` digest through every environment.
- Secret-free PR CI runs the exact production container against synthetic runtime config.
- Root layout uses dynamic rendering (`force-dynamic`) to read per-environment config at request time, which is an intentional trade-off for build-once portability.
