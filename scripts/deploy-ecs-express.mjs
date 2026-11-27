#!/usr/bin/env node
/**
 * Safe read-modify-write Amazon ECS Express Mode deploy helper.
 *
 * Why this exists:
 * `aws ecs update-express-gateway-service --primary-container` replaces the
 * primaryContainer object. Passing only `image` wipes out `environment`,
 * `secrets` (SSM Parameter Store ARNs), `containerPort`, `command`, and
 * `awsLogsConfiguration`.
 *
 * This helper:
 * 1. Enforces an immutable `@sha256:<64-hex>` image digest URI (never mutable tags).
 * 2. Reads the live Express service via `describe-express-gateway-service`.
 * 3. Deep-clones the active `primaryContainer` and replaces ONLY `image`.
 * 4. Calls `update-express-gateway-service` and waits until the new revision is
 *    ACTIVE and serving the requested digest.
 * 5. Verifies `GET /healthz` (200) and `GET /readyz` (200) on the live HTTPS URL.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DIGEST_IMAGE_URI_REGEX = /^[a-z0-9][a-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const TERMINAL_FAILURE_STATUSES = new Set(["DRAINING", "INACTIVE"]);

/**
 * Validates that an image URI is pinned to an immutable SHA-256 digest.
 * @param {string} imageUri
 */
export function validateDigestImageUri(imageUri) {
  if (typeof imageUri !== "string" || !DIGEST_IMAGE_URI_REGEX.test(imageUri.trim())) {
    throw new Error(
      `Invalid image URI: must be pinned to an immutable @sha256:<64-hex> digest (got ${JSON.stringify(imageUri)}).`,
    );
  }
}

/**
 * Selects the newest active configuration from an ECS Express Gateway service.
 * @param {{ activeConfigurations?: Array<Record<string, any>> }} service
 */
export function getActiveConfiguration(service) {
  const configs = service?.activeConfigurations;
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error("Existing ECS Express service has no activeConfigurations.");
  }

  return [...configs].sort((a, b) => Number(b?.createdAt ?? 0) - Number(a?.createdAt ?? 0))[0];
}

/**
 * Builds a safe read-modify-write ECS Express Mode `primaryContainer` payload
 * that preserves all existing environment variables, SSM secrets, containerPort,
 * command, repositoryCredentials, and awsLogsConfiguration while updating only `image`.
 *
 * @param {{ activeConfigurations?: Array<Record<string, any>> }} existingService
 * @param {string} imageUri
 */
export function buildSafeUpdatePrimaryContainer(existingService, imageUri) {
  validateDigestImageUri(imageUri);

  const activeConfig = getActiveConfiguration(existingService);
  const primaryContainer = activeConfig?.primaryContainer;
  if (!primaryContainer || typeof primaryContainer !== "object") {
    throw new Error(
      "Existing ECS Express service active configuration is missing primaryContainer.",
    );
  }

  const nextPrimaryContainer = structuredClone(primaryContainer);
  nextPrimaryContainer.image = imageUri.trim();

  return nextPrimaryContainer;
}

/**
 * Verifies that the ACTIVE ECS Express service is actually serving the expected
 * immutable digest (catching silent rollbacks on failed deployments).
 *
 * @param {{ activeConfigurations?: Array<Record<string, any>> }} service
 * @param {string} expectedImageUri
 */
export function assertDeployedImageDigest(service, expectedImageUri) {
  validateDigestImageUri(expectedImageUri);
  const activeConfig = getActiveConfiguration(service);
  const actual = activeConfig?.primaryContainer?.image ?? "";
  if (actual.trim() !== expectedImageUri.trim()) {
    throw new Error(
      `ECS Express service is running unexpected image (${JSON.stringify(actual)}) instead of requested digest (${JSON.stringify(expectedImageUri)}). The deployment may have failed and auto-rolled back.`,
    );
  }
}

/**
 * Resolves the canonical HTTPS URL from an ECS Express service's ingressPaths.
 * @param {{ activeConfigurations?: Array<Record<string, any>> }} service
 */
export function resolveExpressServiceUrl(service) {
  const activeConfig = getActiveConfiguration(service);
  const endpoint = activeConfig?.ingressPaths?.[0]?.endpoint ?? "";
  if (!endpoint) {
    return "";
  }
  return endpoint.startsWith("http://") || endpoint.startsWith("https://")
    ? endpoint
    : `https://${endpoint}`;
}

/**
 * Polls `/healthz` and `/readyz` on the deployed ECS Express URL until both
 * return HTTP 200 or maxAttempts is exhausted.
 *
 * @param {{
 *   baseUrl: string;
 *   fetchImpl?: typeof fetch;
 *   maxAttempts?: number;
 *   delayMs?: number;
 * }} options
 */
export async function verifyServiceHealth({
  baseUrl,
  fetchImpl = fetch,
  maxAttempts = 20,
  delayMs = 5000,
}) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const probes = [
    { path: "/healthz", expectedStatus: "ok" },
    { path: "/readyz", expectedStatus: "ready" },
  ];

  for (const probe of probes) {
    const url = `${normalizedBase}${probe.path}`;
    let lastError = "no response";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }

          if (!payload || payload.status === probe.expectedStatus) {
            lastError = "";
            break;
          }
          lastError = `unexpected status payload (${String(payload.status)})`;
        } else {
          lastError = `HTTP ${response.status}`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < maxAttempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (lastError) {
      throw new Error(
        `Health verification failed for ${probe.path} after ${maxAttempts} attempt(s): ${lastError}`,
      );
    }
  }
}

function runAwsJson(args) {
  const stdout = execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

async function waitForDeploymentComplete({
  serviceArn,
  region,
  expectedImageUri,
  targetRevisionArn = "",
  timeoutMs = 15 * 60 * 1000,
}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { service } = runAwsJson([
      "ecs",
      "describe-express-gateway-service",
      "--service-arn",
      serviceArn,
      "--region",
      region,
    ]);

    const statusCode = service?.status?.statusCode ?? "UNKNOWN";
    const activeConfigs = service?.activeConfigurations ?? [];
    const currentDeployment = service?.currentDeployment ?? "";
    const newestConfig = activeConfigs.length > 0 ? getActiveConfiguration(service) : null;
    const activeImage = newestConfig?.primaryContainer?.image ?? "";
    const activeRevision = newestConfig?.serviceRevisionArn ?? "";

    console.log(
      `[deploy-ecs-express] Status=${statusCode} activeConfigs=${activeConfigs.length} currentDeployment=${currentDeployment || "none"}`,
    );

    if (TERMINAL_FAILURE_STATUSES.has(statusCode)) {
      throw new Error(
        `ECS Express service entered terminal state: ${statusCode} (${service?.status?.statusReason ?? "no reason"})`,
      );
    }

    const cluster = service?.cluster;
    if (cluster) {
      const describedEcs = runAwsJson([
        "ecs",
        "describe-services",
        "--cluster",
        cluster,
        "--services",
        serviceArn,
        "--region",
        region,
      ]);
      const ecsService = describedEcs?.services?.[0];
      const primaryDeployment = ecsService?.deployments?.find((d) => d.status === "PRIMARY");
      if (primaryDeployment?.rolloutState === "FAILED") {
        throw new Error(
          `ECS Express deployment failed: ${primaryDeployment.rolloutStateReason ?? "rollout failed"}`,
        );
      }

      const rolloutCompleted = !primaryDeployment || primaryDeployment.rolloutState === "COMPLETED";
      const revisionMatches = !targetRevisionArn || activeRevision === targetRevisionArn;
      if (
        statusCode === "ACTIVE" &&
        rolloutCompleted &&
        activeImage.trim() === expectedImageUri.trim() &&
        revisionMatches
      ) {
        return service;
      }
    } else if (
      statusCode === "ACTIVE" &&
      !currentDeployment &&
      activeImage.trim() === expectedImageUri.trim()
    ) {
      return service;
    }

    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  throw new Error("Timed out waiting for ECS Express service deployment to complete.");
}

function parseCliArgs(argv) {
  const parsed = {
    serviceArn: process.env.ECS_SERVICE_ARN ?? "",
    imageUri: process.env.IMAGE_URI ?? "",
    region: process.env.AWS_REGION ?? "ap-southeast-2",
    healthBaseUrl: process.env.HEALTH_BASE_URL ?? "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--service-arn") {
      parsed.serviceArn = argv[++i] ?? "";
    } else if (arg === "--image-uri") {
      parsed.imageUri = argv[++i] ?? "";
    } else if (arg === "--region") {
      parsed.region = argv[++i] ?? "ap-southeast-2";
    } else if (arg === "--health-base-url") {
      parsed.healthBaseUrl = argv[++i] ?? "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export async function deployEcsExpressService({
  serviceArn,
  imageUri,
  region = "ap-southeast-2",
  healthBaseUrl = "",
}) {
  if (!serviceArn) {
    throw new Error("Missing required --service-arn (or ECS_SERVICE_ARN env var).");
  }
  validateDigestImageUri(imageUri);

  console.log(`[deploy-ecs-express] Reading current service configuration in ${region}...`);
  const described = runAwsJson([
    "ecs",
    "describe-express-gateway-service",
    "--service-arn",
    serviceArn,
    "--region",
    region,
  ]);
  const currentService = described.service;

  const nextPrimaryContainer = buildSafeUpdatePrimaryContainer(currentService, imageUri);
  const updateInput = JSON.stringify({
    serviceArn,
    primaryContainer: nextPrimaryContainer,
  });

  console.log(`[deploy-ecs-express] Updating service to immutable digest ${imageUri}...`);
  const updated = runAwsJson([
    "ecs",
    "update-express-gateway-service",
    "--region",
    region,
    "--cli-input-json",
    updateInput,
  ]);
  const targetRevisionArn = updated?.service?.targetConfiguration?.serviceRevisionArn ?? "";

  const activeService = await waitForDeploymentComplete({
    serviceArn,
    region,
    expectedImageUri: imageUri,
    targetRevisionArn,
  });
  assertDeployedImageDigest(activeService, imageUri);

  const resolvedUrl = healthBaseUrl || resolveExpressServiceUrl(activeService);
  if (!resolvedUrl) {
    throw new Error("Could not determine ECS Express service endpoint for health verification.");
  }

  console.log(`[deploy-ecs-express] Verifying /healthz and /readyz on ${resolvedUrl}...`);
  await verifyServiceHealth({ baseUrl: resolvedUrl });
  console.log("[deploy-ecs-express] Health and readiness probes passed.");

  return {
    serviceArn,
    serviceUrl: resolvedUrl,
    imageUri,
    status: activeService?.status?.statusCode ?? "ACTIVE",
  };
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  deployEcsExpressService(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(
        `[deploy-ecs-express] Deploy complete: ${result.serviceUrl} -> ${result.imageUri}`,
      );
    })
    .catch((error) => {
      console.error(
        `[deploy-ecs-express] Deploy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    });
}
