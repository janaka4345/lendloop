# AWS Console Setup & Operations Runbook (Single-Account `us-east-1`)

This 4-part runbook documents the repeatable, non-IaC AWS Console setup and day-to-day operations for LendLoop's 4-environment (`dev` → `qa` → `staging` → `prod`) build-once, digest-promoted pipeline on **Amazon ECR** and **AWS App Runner** (see [ADR-0005](adr/0005-build-once-container-and-runtime-config.md) and [ADR-0006](adr/0006-lean-ecr-app-runner-digest-promotion.md)).

> **Scope:** Single AWS account, region **`us-east-1`**, zero Terraform/CDK, demo-sized compute (`0.25 vCPU / 0.5 GB`), free-tier SSM Parameter Store secrets, and least-privilege GitHub OIDC IAM roles.

---

## Part 1: Account Baseline, Guardrails & Amazon ECR (`us-east-1`)

### 1.1 CloudTrail (Free-Tier Management Events)

1. Open **AWS Console → CloudTrail → Trails → Create trail**.
2. Name: `lendloop-management-events`.
3. Enable **Management events** (`Read` + `Write`). Leave **Data events** and **Insights** disabled to remain within the free single-trail management-event tier.
4. Store logs in a dedicated S3 bucket with default SSE-S3 encryption and public access blocked.

### 1.2 AWS Budgets (Gross + \$1 Alert)

1. Open **AWS Billing and Cost Management → Budgets → Create a budget**.
2. Choose **Cost budget** (Monthly, Recurring).
3. Configure two budgets:
   - **\$1 Early-Warning Budget (`lendloop-monthly-1usd`):** Budget amount **\$1.00 USD**, alert at **80% actual** and **100% forecasted**.
   - **Gross Cap Budget (`lendloop-monthly-gross-cap`):** Set to your monthly evaluation ceiling (e.g., **\$15.00 USD**), alert at **50%**, **80%**, and **100%** actual/forecasted.
4. Attach your operator email address to all threshold notifications.

### 1.3 Amazon ECR Repository (`lendloop-web`)

1. Open **Amazon ECR → Repositories → Create repository** in **`us-east-1`**.
2. Settings:
   - Visibility: **Private**
   - Repository name: `lendloop-web`
   - Tag immutability: **Enabled** (prevents overwriting commit-SHA tags)
   - Scan on push: **Enabled** (basic scanning)
   - Encryption: **AES-256**
3. Attach a **30-day Lifecycle Policy** (**Repository → Lifecycle Policy → Create rule**) to keep storage costs near zero while preserving recent digests for fast rollback:

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
      "description": "Expire images older than 30 days (keep at least 10 most recent via count rule if preferred)",
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

1. Open **IAM → Identity providers → Add provider**.
2. Provider type: **OpenID Connect**
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

### 2.2 Three Least-Privilege GitHub OIDC IAM Roles

Create **3 separate IAM roles** (never share the `prod` role with non-prod workflows). Replace `<ACCOUNT_ID>` and `<OWNER>/<REPO>` with your AWS account ID and GitHub repository slug.

| IAM Role Name                   | Used By Workflow / Environment                      | Permitted Scope                                                                  |
| ------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `lendloop-gha-dev-build-deploy` | `cd.yml` (`environment: dev`, `main` push)          | Push/read `lendloop-web` ECR + describe/resume/update **only** `lendloop-dev`    |
| `lendloop-gha-nonprod-promote`  | `promote.yml` (`environment: qa`, `staging`)        | Read-only ECR `DescribeImages` + describe/resume/update `lendloop-qa`/`staging`  |
| `lendloop-gha-prod-promote`     | `promote.yml` (`environment: prod`, manual approve) | Read-only ECR `DescribeImages` + describe/resume/update **only** `lendloop-prod` |

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
- For `lendloop-gha-nonprod-promote`, use `StringLike` or an array matching `"repo:<OWNER>/<REPO>:environment:qa"` and `"repo:<OWNER>/<REPO>:environment:staging"`.

#### Inline Permissions Pattern (example for `lendloop-gha-prod-promote`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VerifyDigestInEcr",
      "Effect": "Allow",
      "Action": ["ecr:DescribeImages"],
      "Resource": "arn:aws:ecr:us-east-1:<ACCOUNT_ID>:repository/lendloop-web"
    },
    {
      "Sid": "UpdateOnlyProdAppRunner",
      "Effect": "Allow",
      "Action": ["apprunner:DescribeService", "apprunner:ResumeService", "apprunner:UpdateService"],
      "Resource": "arn:aws:apprunner:us-east-1:<ACCOUNT_ID>:service/lendloop-prod/*"
    }
  ]
}
```

- For `lendloop-gha-dev-build-deploy`, also grant `ecr:GetAuthorizationToken` (`Resource: "*"`) and `ecr:BatchCheckLayerAvailability`, `ecr:CompleteLayerUpload`, `ecr:InitiateLayerUpload`, `ecr:PutImage`, `ecr:UploadLayerPart`, `ecr:DescribeImages` scoped to `repository/lendloop-web`, plus explicit `apprunner:DescribeService`, `apprunner:ResumeService`, and `apprunner:UpdateService` scoped to `service/lendloop-dev/*`.

### 2.3 SSM Parameter Store `SecureString` Secrets (Free Tier)

Open **AWS Systems Manager → Parameter Store** in `us-east-1` and create standard-tier `SecureString` parameters (encrypted with the default AWS-managed KMS key `alias/aws/ssm`, free tier) under `/lendloop/<env>/`:

| Parameter Path                          | Used In Env | Notes                                         |
| --------------------------------------- | ----------- | --------------------------------------------- |
| `/lendloop/<env>/CLERK_PUBLISHABLE_KEY` | All 4       | `pk_test_*` (non-prod) / `pk_live_*` (`prod`) |
| `/lendloop/<env>/CLERK_SECRET_KEY`      | All 4       | `sk_test_*` (non-prod) / `sk_live_*` (`prod`) |
| `/lendloop/<env>/SENTRY_DSN`            | Optional    | Omit or leave unset for clean no-op           |

Non-secret runtime variables (`APP_ENV`, `APP_URL`, `CONVEX_URL`, optional `CLERK_FRONTEND_API_URL`) are stored as plain `RuntimeEnvironmentVariables` on each App Runner service.

### 2.4 1:1 Environment Isolation Matrix (`Clerk` / `Convex` / `n8n`)

Every environment has strict 1:1 isolation across all external dependencies — never point two environments at the same Clerk instance, Convex deployment, or n8n webhook path:

| Environment | App Runner Service | Clerk Instance    | Convex Deployment | n8n Webhook Path Prefix         | `BOOTSTRAP_ADMIN_EMAILS` |
| ----------- | ------------------ | ----------------- | ----------------- | ------------------------------- | ------------------------ |
| `dev`       | `lendloop-dev`     | Dev (`pk_test_`)  | `dev` deployment  | `/webhook/dev/lendloop-...`     | Optional (dev only)      |
| `qa`        | `lendloop-qa`      | QA (`pk_test_`)   | `qa` deployment   | `/webhook/qa/lendloop-...`      | Unset                    |
| `staging`   | `lendloop-staging` | Staging           | `staging` deploy  | `/webhook/staging/lendloop-...` | Unset                    |
| `prod`      | `lendloop-prod`    | Prod (`pk_live_`) | `prod` deployment | `/webhook/prod/lendloop-...`    | **Must be unset**        |

### 2.5 GitHub Environments Configuration

In **GitHub → Settings → Environments**, create `dev`, `qa`, `staging`, and `prod`:

- **Protection rules:** Enable **Required reviewers** on **`staging`** and **`prod`** (and optionally restrict deployment branches to `main`).
- **Environment variables (`vars`):**
  - `AWS_ROLE_ARN` — The matching OIDC IAM role ARN from Section 2.2.
  - `APPRUNNER_SERVICE_ARN` — The matching App Runner service ARN from Part 3.
  - `APP_URL` — Canonical HTTPS URL for `/healthz` and `/readyz` verification.
- **Environment secrets (`secrets`):**
  - `CONVEX_DEPLOY_KEY` — Per-environment Convex deploy key from the Convex Dashboard.

---

## Part 3: AWS App Runner Services & CloudWatch Retention

### 3.1 Supporting App Runner IAM Roles

1. **ECR Access Role (`lendloop-apprunner-ecr-access`):**
   - Trust entity: `build.apprunner.amazonaws.com`
   - Managed policy: `AWSAppRunnerServicePolicyForECRAccess`
2. **Per-Environment Instance Roles (`lendloop-apprunner-instance-<env>`):**
   - Trust entity: `tasks.apprunner.amazonaws.com`
   - Inline policy with two statements:
     1. `ssm:GetParameters` scoped strictly to `arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/lendloop/<env>/*`.
     2. `kms:Decrypt` scoped to `arn:aws:kms:us-east-1:<ACCOUNT_ID>:key/*` with condition `StringEquals: { "kms:ViaService": "ssm.us-east-1.amazonaws.com" }` (allows decrypting SSM `SecureString` parameters via the default `alias/aws/ssm` KMS key without granting direct KMS access).

### 3.2 Create 4 Demo-Sized App Runner Services

Create `lendloop-dev`, `lendloop-qa`, `lendloop-staging`, and `lendloop-prod` in **AWS App Runner (`us-east-1`)** using the initial ECR image digest pushed by `cd.yml`:

- **Source:** Container registry → Amazon ECR → `lendloop-web@sha256:<digest>`
- **Deployment trigger:** **Manual** (`AutoDeploymentsEnabled: false`)
- **ECR access role:** `lendloop-apprunner-ecr-access`
- **Port:** `3000`
- **Compute size:** **0.25 vCPU / 0.5 GB RAM**
- **Auto scaling:**
  - `dev`, `qa`, `staging`: `min: 1`, **`max: 1`** (pause service when idle between review sessions)
  - `prod`: `min: 1`, **`max: 2`**
- **Health check:** HTTP `GET /healthz`, interval `10s`, timeout `5s`, healthy threshold `1`, unhealthy threshold `3`.
- **Instance role:** `lendloop-apprunner-instance-<env>`
- **Runtime environment variables:** `APP_ENV=<env>`, `APP_URL=https://<service-domain>`, `CONVEX_URL=https://<env-deployment>.convex.cloud`
- **Runtime environment secrets (SSM):** Map `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` (and optional `SENTRY_DSN`) to their `/lendloop/<env>/*` SSM parameter ARNs.

### 3.3 CloudWatch Log Retention (`14d` Non-Prod / `90d` Prod)

App Runner creates log groups under `/aws/apprunner/lendloop-<env>/<service-id>/service` and `.../application` with default **Never expire** retention. Immediately set finite retention in **CloudWatch → Log groups**:

- `lendloop-dev`, `lendloop-qa`, `lendloop-staging`: **14 days**
- `lendloop-prod`: **90 days**

---

## Part 4: Operations, Promotion, Digest Verification & Zero-Rebuild Rollback

### 4.1 Build-Once Promotion Flow (`dev` → `qa` → `staging` → `prod`)

1. Merging a PR to `main` triggers **CD (Build Once & Deploy Dev)** (`.github/workflows/cd.yml`):
   - Builds the standalone Next.js container once, scans it with Grype (`critical`, `only-fixed`), pushes to ECR, and resolves the exact `@sha256:` digest.
   - Runs `npx convex deploy --yes` against `dev`.
   - Calls `node scripts/deploy-apprunner.mjs` (read-modify-write preserving all SSM secrets and runtime env vars) to update `lendloop-dev` and verify `/healthz` + `/readyz`.
   - Prints the exact `sha256:<64-hex>` digest in the workflow summary.
2. To promote that exact artifact through `qa` → `staging` → `prod`, run **CD Promote & Rollback** (`.github/workflows/promote.yml`) via **Actions → Run workflow**:
   - `image_digest`: paste `sha256:<64-hex>` from the `cd.yml` summary.
   - `mode`: `promote`
   - `max_environment`: `prod` (or `qa` / `staging` for partial promotion).
   - GitHub pauses before `staging` and `prod` for manual reviewer approval.

### 4.2 Expand-and-Contract Convex Schema Discipline

Because App Runner container updates and `npx convex deploy` are two separate operations, follow **expand-and-contract** for all Convex schema changes:

1. **Expand:** Add new optional fields/indexes and ship code that reads both old and new shapes.
2. **Backfill:** Run any required migration while both old and new containers remain compatible.
3. **Contract:** Remove deprecated fields only in a subsequent release after `prod` is stably running the new digest.

This guarantees that a container-only rollback (`skip_convex_deploy: true`) is always backward-compatible with the live Convex schema.

### 4.3 Local Published-Digest Verification (Reviewer Portability Check)

To prove the exact ECR digest runs locally with zero rebuild against local/reviewer runtime env vars:

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

LENDLOOP_IMAGE="<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/lendloop-web@sha256:<64-hex>" \
  docker compose -f docker-compose.yml -f docker-compose.published.yml up --no-build
```

Verify `http://localhost:3000/healthz`, `http://localhost:3000/readyz`, and `http://localhost:3000/api/config`.

### 4.4 Pausing Idle Non-Prod Services

To keep AWS spend near \$0 between demos, pause idle non-prod services:

```bash
aws apprunner pause-service --region us-east-1 --service-arn "$APPRUNNER_SERVICE_ARN"
```

When the next `cd.yml` or `promote.yml` run targets a paused service, `scripts/deploy-apprunner.mjs` automatically resumes it before applying the new digest.

### 4.5 Zero-Rebuild Rollback Procedure

#### Option A: GitHub Actions (Recommended, Audited)

1. Identify the last known-good `sha256:<64-hex>` digest from a previous `cd.yml` summary or `aws ecr describe-images --repository-name lendloop-web --region us-east-1`.
2. Open **Actions → CD Promote & Rollback → Run workflow**:
   - `image_digest`: `<last-known-good-sha256>`
   - `mode`: `rollback`
   - `rollback_environment`: `prod` (or `staging` / `qa` / `dev`)
   - `skip_convex_deploy`: `true` (fast zero-rebuild container rollback; set `false` only if you also need to re-deploy checked-out Convex functions).
3. Approve the `prod` environment gate if prompted. `scripts/deploy-apprunner.mjs` updates `ImageIdentifier` in place while preserving all SSM secrets and verifies `/healthz` and `/readyz`.

#### Option B: Emergency Local AWS CLI Rollback

If GitHub Actions is unavailable, run the exact same read-modify-write helper from an authenticated operator shell:

```bash
node scripts/deploy-apprunner.mjs \
  --service-arn "arn:aws:apprunner:us-east-1:<ACCOUNT_ID>:service/lendloop-prod/<SERVICE_ID>" \
  --image-uri "<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/lendloop-web@sha256:<LAST_KNOWN_GOOD>" \
  --region us-east-1
```
