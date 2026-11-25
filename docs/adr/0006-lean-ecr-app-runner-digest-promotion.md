# ADR-0006: Lean ECR & App Runner Digest Promotion

**Status:** Accepted

## Context

LendLoop requires a reliable 4-environment deployment pipeline (`dev` → `qa` → `staging` → `prod`) with immutable artifact promotion, isolated backends, manual release gates, and fast rollback — without the cost, operational overhead, or VPC/ALB complexity of ECS Fargate + multi-account AWS Organizations for an evaluation-scale platform.

## Decision

1. **Single-account AWS ECR + App Runner:** Maintain one Amazon ECR repository (`lendloop-web` in `us-east-1`, 30-day lifecycle policy) and four demo-sized AWS App Runner services (`0.25 vCPU / 0.5 GB`; non-prod `max: 1` paused when idle; `prod` `max: 2`).
2. **Least-privilege OIDC & free-tier secrets:** Authenticate GitHub Actions via 3 OIDC IAM roles (with a dedicated `prod` role) and inject environment secrets via AWS SSM Parameter Store `SecureString` parameters paired with 1:1 isolated Convex deployments, Clerk instances, and n8n `/webhook/<env>/` paths.
3. **Build once, promote by `@sha256:` digest:** Build and scan the container image once on `main`, push to ECR, and promote the exact immutable `@sha256:` digest sequentially through `dev` → `qa` → `staging` → `prod`, with GitHub Environment manual approvals gating `staging` and `prod`, coordinated `npx convex deploy` (expand-and-contract), a safe read-modify-write App Runner deploy helper, and a zero-rebuild digest rollback workflow.
4. **Cost & observability guardrails:** CloudWatch log retention (14 days non-prod / 90 days `prod`), free AWS CloudTrail management events, gross + \$1 AWS Budgets alerts, and runtime-optional Sentry.

## Consequences

- Every environment runs the exact byte-for-byte container digest verified in CI and `qa`, and rollbacks take minutes with zero rebuild.
- Operating cost stays near zero when non-prod services are paused, while preserving clear promotion discipline.
- Moving to multi-account AWS Organizations + IaC (Terraform/CDK) is documented as a Day-2 production upgrade in `README.md`.
