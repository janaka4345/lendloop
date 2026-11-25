# ADR-0001: Modular Monolith & Convex Seams

**Status:** Accepted

## Context

LendLoop needs a cohesive full-stack architecture that stays simple to run locally, deploy, and test without premature microservice overhead, while preventing domain rules (such as `Loan` conflict detection, UTC date arithmetic, and PII redaction) from tangling with Next.js or Convex framework code.

## Decision

Organize the repository as a **domain-sliced modular monolith** across five vertical slices (`listings`, `lending`, `users`, `automation`, `audit`):

1. **Zero-dependency pure domain core (`src/domain/`):** Contains the `Loan` state machine, UTC `YYYY-MM-DD` validation and overlap math, `Availability`/`Overdue` derivation, retry backoff with ±20% jitter, and PII/secret redaction. Enforced by ESLint `no-restricted-imports` to forbid any framework, runtime, or third-party imports.
2. **Backend domain slices (`convex/<slice>/`):** Convex queries, mutations, actions, and HTTP handlers live per slice. Cross-slice calls are restricted by ESLint to each slice's exported `seam.ts` (or `index.ts`) — never internal helpers.
3. **Frontend feature slices (`src/features/<slice>/`) & thin routing shell (`src/app/`):** Components, hooks, and Zod schemas live in feature slices while Next.js App Router pages stay thin.

## Consequences

- Pure domain logic is shared identically between Convex backend handlers and Next.js client forms, and tested directly in fast Vitest unit tests with a >=80% coverage gate.
- Cross-slice coupling is caught mechanically at lint time (`pnpm lint`) rather than drifting in code review.
- Any slice (such as `automation` or `listings` image storage) can later be extracted behind its existing seam without rewriting callers.
