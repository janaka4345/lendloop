# AWS Setup & Operations Runbook (Single-Account `ap-southeast-2`)

This 4-part runbook documents the repeatable, non-IaC AWS setup and day-to-day operations for LendLoop's 4-environment (`dev` → `qa` → `staging` → `prod`) build-once, digest-promoted pipeline on **Amazon ECR** and **Amazon ECS Express Mode** (see [ADR-0005](adr/0005-build-once-container-and-runtime-config.md) and [ADR-0006](adr/0006-lean-ecr-app-runner-digest-promotion.md); AWS App Runner was sunset on April 30, 2026 in favor of Amazon ECS Express Mode).

> **Scope:** Single AWS project, region **`ap-southeast-2`**, zero Terraform/CDK, demo-sized Fargate compute (`0.25 vCPU / 0.5 GB`), free-tier SSM Parameter Store secrets, and least-privilege GitHub OIDC IAM roles.

---

## Part 1: Baseline, Guardrails & Amazon ECR (`ap-southeast-2`)

### 1.1 CloudTrail (Free-Tier Management Events)

1. Open **AWS Console → CloudTrail → Trails → Create trail**.
2. Name: `lendloop-management-events`.
3. Enable **Management events** (`Read` + `Write`). Leave **Data events** and **Insights** disabled to remain within the free single-trail management-event tier.
4. Store logs in a dedicated S3 bucket with default SSE-S3 encryption and public access blocked.

### 1.2 AWS Budgets (Gross + \$1 Alert)

1. Open **AWS Billing and Cost Management → Budgets → Create a budget**.
2. Choose **Cost budget** (Monthly, Recurring).
3. Configure two budgets:
   - **\$1 Early-Warning Budget:** Budget amount **\$1.00 USD**, alert at **80% actual** and **100% forecasted**.
   - **Gross Cap Budget:** Set to your monthly evaluation ceiling (e.g., **\$5.00–\$15.00 USD**), alert at **50%**, **80%**, and **100%** actual/forecasted.
4. Attach your operator email address to all threshold notifications.

### 1.3 Amazon ECR Repository (`lendloop-web`)

1. Create private repository **`lendloop-web`** in **`ap-southeast-2`** with:
   - Tag immutability: **IMMUTABLE** (prevents overwriting commit-SHA tags)
   - Scan on push: **Enabled** (basic scanning)
   - Encryption: **AES-256**
2. Attach a **7-day untagged / 30-day expiry Lifecycle Policy**:

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Expire images older than 30 days",
      "selection": {
        "tagStatus": "any",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 30
      },
      "action": { "type": "expire" }
    }
  ]
}
```

---

## Part 2: Identity, Least-Privilege GitHub OIDC, SSM Secrets & 1:1 Environment Isolation

### 2.1 GitHub OIDC Identity Provider

1. Open **IAM → Identity providers → Add provider** (or `aws iam create-open-id-connect-provider`).
2. Provider type: **OpenID Connect**
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

### 2.2 Three Least-Privilege GitHub OIDC IAM Roles

Create **3 separate IAM roles** (never share the `prod` role with non-prod workflows). Replace `<ACCOUNT_ID>` and `<OWNER>/<REPO>` with your AWS project ID and GitHub repository slug.

| IAM Role Name                   | Used By Workflow / Environment                      | Permitted Scope                                                                                   |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `lendloop-gha-dev-build-deploy` | `cd.yml` (`environment: dev`, `main` push)          | Push/read `lendloop-web` ECR + describe/update **only** `lendloop-dev` + scoped `iam:PassRole`    |
| `lendloop-gha-nonprod-promote`  | `promote.yml` (`environment: qa`, `staging`)        | Read-only ECR `DescribeImages` + describe/update `lendloop-qa`/`staging` + scoped `iam:PassRole`  |
| `lendloop-gha-prod-promote`     | `promote.yml` (`environment: prod`, manual approve) | Read-only ECR `DescribeImages` + describe/update **only** `lendloop-prod` + scoped `iam:PassRole` |

#### Trust Policy Pattern (example for `lendloop-gha-prod-promote`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:environment:prod"
        }
      }
    }
  ]
}
```

- For `lendloop-gha-dev-build-deploy`, scope `sub` to `"repo:<OWNER>/<REPO>:environment:dev"`.
- For `lendloop-gha-nonprod-promote`, scope `sub` to `["repo:<OWNER>/<REPO>:environment:qa", "repo:<OWNER>/<REPO>:environment:staging"]`.

#### Inline Permissions Pattern (example for `lendloop-gha-prod-promote`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VerifyDigestInEcr",
      "Effect": "Allow",
      "Action": ["ecr:DescribeImages"],
      "Resource": "arn:aws:ecr:ap-southeast-2:<ACCOUNT_ID>:repository/lendloop-web"
    },
    {
      "Sid": "EcsExpressProd",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeExpressGatewayService",
        "ecs:UpdateExpressGatewayService",
        "ecs:DescribeServices"
      ],
      "Resource": "arn:aws:ecs:ap-southeast-2:<ACCOUNT_ID>:service/*/lendloop-prod"
    },
    {
      "Sid": "PassEcsProdRoles",
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/lendloop-ecs-express-infra",
        "arn:aws:iam::<ACCOUNT_ID>:role/lendloop-ecs-execution-prod"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": ["ecs.amazonaws.com", "ecs-tasks.amazonaws.com"]
        }
      }
    }
  ]
}
```

- For `lendloop-gha-dev-build-deploy`, also grant `ecr:GetAuthorizationToken` (`Resource: "*"`) and `ecr:BatchCheckLayerAvailability`, `ecr:CompleteLayerUpload`, `ecr:InitiateLayerUpload`, `ecr:PutImage`, `ecr:UploadLayerPart`, `ecr:DescribeImages` scoped to `repository/lendloop-web`, plus ECS Express permissions scoped to `service/*/lendloop-dev` and `iam:PassRole` for `lendloop-ecs-express-infra` + `lendloop-ecs-execution-dev`.

### 2.3 SSM Parameter Store `SecureString` Secrets (Free Tier)

In **AWS Systems Manager → Parameter Store** (`ap-southeast-2`), create standard-tier `SecureString` parameters (encrypted with the default AWS-managed KMS key `alias/aws/ssm`, free tier) under `/lendloop/<env>/`:

| Parameter Path                          | Used In Env | Notes                                         |
| --------------------------------------- | ----------- | --------------------------------------------- |
| `/lendloop/<env>/CLERK_PUBLISHABLE_KEY` | All 4       | `pk_test_*` (non-prod) / `pk_live_*` (`prod`) |
| `/lendloop/<env>/CLERK_SECRET_KEY`      | All 4       | `sk_test_*` (non-prod) / `sk_live_*` (`prod`) |
| `/lendloop/<env>/SENTRY_DSN`            | Optional    | Omit or leave unset for clean no-op           |

Non-secret runtime variables (`APP_ENV`, `APP_URL`, `CONVEX_URL`, optional `CLERK_FRONTEND_API_URL`) are stored as plain container `environment` entries on each ECS Express Mode service.

### 2.4 1:1 Environment Isolation Matrix (`Clerk` / `Convex` / `n8n`)

Every environment has strict 1:1 isolation across all external dependencies — never point two environments at the same Clerk instance, Convex deployment, or n8n webhook path in production:

| Environment | ECS Express Service | Clerk Instance    | Convex Deployment | n8n Webhook Path Prefix         | `BOOTSTRAP_ADMIN_EMAILS` |
| ----------- | ------------------- | ----------------- | ----------------- | ------------------------------- | ------------------------ |
| `dev`       | `lendloop-dev`      | Dev (`pk_test_`)  | `dev` deployment  | `/webhook/dev/lendloop-...`     | Optional (dev only)      |
| `qa`        | `lendloop-qa`       | QA (`pk_test_`)   | `qa` deployment   | `/webhook/qa/lendloop-...`      | Unset                    |
| `staging`   | `lendloop-staging`  | Staging           | `staging` deploy  | `/webhook/staging/lendloop-...` | Unset                    |
| `prod`      | `lendloop-prod`     | Prod (`pk_live_`) | `prod` deployment | `/webhook/prod/lendloop-...`    | **Must be unset**        |

### 2.5 GitHub Environments Configuration

In **GitHub → Settings → Environments**, create `dev`, `qa`, `staging`, and `prod`:

- **Protection rules:** Enable **Required reviewers** on **`staging`** and **`prod`** (and optionally restrict deployment branches to `main`).
- **Environment variables (`vars`):**
  - `AWS_ROLE_ARN` — The matching OIDC IAM role ARN from Section 2.2.
  - `ECS_SERVICE_ARN` — The matching ECS Express Mode service ARN from Part 3.
  - `APP_URL` — Canonical HTTPS URL for `/healthz` and `/readyz` verification.
- **Environment secrets (`secrets`):**
  - `CONVEX_DEPLOY_KEY` — Per-environment Convex deploy key from the Convex Dashboard.

---

## Part 3: Amazon ECS Express Mode Services & CloudWatch Retention

### 3.1 Supporting ECS Express Mode IAM Roles

1. **Infrastructure Role (`lendloop-ecs-express-infra`):**
   - Trust entity: `ecs.amazonaws.com` (with `aws:SourceAccount` condition)
   - Managed policy: `arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices`
2. **Per-Environment Task Execution Roles (`lendloop-ecs-execution-<env>`):**
   - Trust entity: `ecs-tasks.amazonaws.com` (with `aws:SourceAccount` + `aws:SourceArn` conditions)
   - Managed policy: `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` (ECR pull + CloudWatch Logs)
   - Inline policy (`lendloop-ssm-secrets-<env>`) with two statements:
     1. `ssm:GetParameters` scoped strictly to `arn:aws:ssm:ap-southeast-2:<ACCOUNT_ID>:parameter/lendloop/<env>/*`.
     2. `kms:Decrypt` scoped to `arn:aws:kms:ap-southeast-2:<ACCOUNT_ID>:key/*` with condition `StringEquals: { "kms:ViaService": "ssm.ap-southeast-2.amazonaws.com" }`.

### 3.2 Create 4 Demo-Sized ECS Express Mode Services

Create `lendloop-dev`, `lendloop-qa`, `lendloop-staging`, and `lendloop-prod` in **Amazon ECS Express Mode (`ap-southeast-2`)** using the initial ECR image digest pushed by `cd.yml`:

- **Image:** `<ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:<digest>`
- **Infrastructure role:** `lendloop-ecs-express-infra`
- **Execution role:** `lendloop-ecs-execution-<env>`
- **Container port:** `3000`
- **Compute size:** **`256` CPU (0.25 vCPU) / `512` memory (0.5 GB RAM)**, `X86_64`
- **Auto scaling (`scalingTarget`):**
  - `dev`, `qa`, `staging`: `minTaskCount: 1`, `maxTaskCount: 1` (scale to `0` when idle between review sessions)
  - `prod`: `minTaskCount: 1`, `maxTaskCount: 2`
- **Health check path:** `/healthz`
- **Runtime environment variables (`primaryContainer.environment`):** `APP_ENV=<env>`, `APP_URL=https://<service-endpoint>`, `CONVEX_URL=https://<env-deployment>.convex.cloud`
- **Runtime secrets (`primaryContainer.secrets`):** Map `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and optional `SENTRY_DSN` to their `/lendloop/<env>/*` SSM parameter ARNs.

Example CLI command for `dev`:

```bash
aws ecs create-express-gateway-service \
  --region ap-southeast-2 \
  --service-name lendloop-dev \
  --infrastructure-role-arn "arn:aws:iam::<ACCOUNT_ID>:role/lendloop-ecs-express-infra" \
  --execution-role-arn "arn:aws:iam::<ACCOUNT_ID>:role/lendloop-ecs-execution-dev" \
  --health-check-path "/healthz" \
  --cpu "256" \
  --memory "512" \
  --scaling-target '{"minTaskCount":1,"maxTaskCount":1}' \
  --primary-container '{
    "image": "<ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:<digest>",
    "containerPort": 3000,
    "environment": [
      {"name": "APP_ENV", "value": "dev"},
      {"name": "CONVEX_URL", "value": "https://<dev-deployment>.convex.cloud"}
    ],
    "secrets": [
      {"name": "CLERK_PUBLISHABLE_KEY", "valueFrom": "arn:aws:ssm:ap-southeast-2:<ACCOUNT_ID>:parameter/lendloop/dev/CLERK_PUBLISHABLE_KEY"},
      {"name": "CLERK_SECRET_KEY", "valueFrom": "arn:aws:ssm:ap-southeast-2:<ACCOUNT_ID>:parameter/lendloop/dev/CLERK_SECRET_KEY"},
      {"name": "SENTRY_DSN", "valueFrom": "arn:aws:ssm:ap-southeast-2:<ACCOUNT_ID>:parameter/lendloop/dev/SENTRY_DSN"}
    ]
  }'
```

### 3.3 CloudWatch Log Retention (`14d` Non-Prod / `90d` Prod)

ECS Express Mode creates log groups under `/aws/ecs/...` with default **Never expire** retention. Immediately set finite retention via `aws logs put-retention-policy`:

- `lendloop-dev`, `lendloop-qa`, `lendloop-staging`: **14 days**
- `lendloop-prod`: **90 days**

---

## Part 4: Operations, Promotion, Digest Verification & Zero-Rebuild Rollback

### 4.1 Build-Once Promotion Flow (`dev` → `qa` → `staging` → `prod`)

1. Merging a PR to `main` triggers **CD (Build Once & Deploy Dev)** (`.github/workflows/cd.yml`):
   - Builds the standalone Next.js container once, scans it with Grype (`critical`, `only-fixed`), pushes to ECR, and resolves the exact `@sha256:` digest.
   - Runs `npx convex deploy --yes` against `dev`.
   - Calls `node scripts/deploy-ecs-express.mjs` (read-modify-write preserving all SSM secrets and runtime env vars) to update `lendloop-dev` and verify `/healthz` + `/readyz`.
   - Prints the exact `sha256:<64-hex>` digest in the workflow summary.
2. To promote that exact artifact through `qa` → `staging` → `prod`, run **CD Promote & Rollback** (`.github/workflows/promote.yml`) via **Actions → Run workflow**:
   - `image_digest`: paste `sha256:<64-hex>` from the `cd.yml` summary.
   - `mode`: `promote`
   - `max_environment`: `prod` (or `qa` / `staging` for partial promotion).
   - GitHub pauses before `staging` and `prod` for manual reviewer approval.

### 4.2 Expand-and-Contract Convex Schema Discipline

Because ECS Express Mode container updates and `npx convex deploy` are two separate operations, follow **expand-and-contract** for all Convex schema changes:

1. **Expand:** Add new optional fields/indexes and ship code that reads both old and new shapes.
2. **Backfill:** Run any required migration while both old and new containers remain compatible.
3. **Contract:** Remove deprecated fields only in a subsequent release after `prod` is stably running the new digest.

This guarantees that a container-only rollback (`skip_convex_deploy: true`) is always backward-compatible with the live Convex schema.

### 4.3 Local Published-Digest Verification (Reviewer Portability Check)

To prove the exact ECR digest runs locally with zero rebuild against local/reviewer runtime env vars:

```bash
aws ecr get-login-password --region ap-southeast-2 \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com

LENDLOOP_IMAGE="<ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:<64-hex>" \
  docker compose -f docker-compose.yml -f docker-compose.published.yml up --no-build
```

Verify `http://localhost:3000/healthz`, `http://localhost:3000/readyz`, and `http://localhost:3000/api/config`.

### 4.4 Scaling Down Idle Non-Prod Services

To keep AWS spend near \$0 between demos, scale idle non-prod services down or delete unused non-prod services:

```bash
aws ecs update-express-gateway-service \
  --region ap-southeast-2 \
  --service-arn "$ECS_SERVICE_ARN" \
  --scaling-target '{"minTaskCount":0,"maxTaskCount":1}'
```

### 4.5 Zero-Rebuild Rollback Procedure

#### Option A: GitHub Actions (Recommended, Audited)

1. Identify the last known-good `sha256:<64-hex>` digest from a previous `cd.yml` summary or `aws ecr describe-images --repository-name lendloop-web --region ap-southeast-2`.
2. Open **Actions → CD Promote & Rollback → Run workflow**:
   - `image_digest`: `<last-known-good-sha256>`
   - `mode`: `rollback`
   - `rollback_environment`: `prod` (or `staging` / `qa` / `dev`)
   - `skip_convex_deploy`: `true` (fast zero-rebuild container rollback; set `false` only if you also need to re-deploy checked-out Convex functions).
3. Approve the `prod` environment gate if prompted. `scripts/deploy-ecs-express.mjs` updates `primaryContainer.image` in place while preserving all SSM secrets and verifies `/healthz` and `/readyz`.

#### Option B: Emergency Local AWS CLI Rollback

If GitHub Actions is unavailable, run the exact same read-modify-write helper from an authenticated operator shell:

```bash
node scripts/deploy-ecs-express.mjs \
  --service-arn "arn:aws:ecs:ap-southeast-2:<ACCOUNT_ID>:service/default/lendloop-prod" \
  --image-uri "<ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:<LAST_KNOWN_GOOD>" \
  --region ap-southeast-2
```
