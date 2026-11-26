#!/usr/bin/env node
/**
 * Safe read-modify-write AWS App Runner deploy helper.
 *
 * Why this exists:
 * `aws apprunner update-service --source-configuration` replaces the entire
 * SourceConfiguration object. Passing only ImageIdentifier wipes out
 * RuntimeEnvironmentVariables, RuntimeEnvironmentSecrets (SSM Parameter Store
 * ARNs), Port, and AuthenticationConfiguration.
 *
 * This helper:
 * 1. Enforces an immutable `@sha256:<64-hex>` image digest URI (never mutable tags).
 * 2. Reads the live service via `describe-service` (resuming first if PAUSED).
 * 3. Deep-clones `SourceConfiguration`, replaces ONLY `ImageRepository.ImageIdentifier`,
 *    and sets `AutoDeploymentsEnabled: false`.
 * 4. Calls `update-service` and waits until the service returns to `RUNNING`.
 * 5. Verifies `GET /healthz` (200) and `GET /readyz` (200) on the live service URL.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DIGEST_IMAGE_URI_REGEX = /^[a-z0-9][a-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const TERMINAL_FAILURE_STATUSES = new Set(["CREATE_FAILED", "DELETE_FAILED", "DELETED"]);

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
 * Builds a safe read-modify-write App Runner SourceConfiguration payload that
 * preserves all existing runtime environment variables, SSM secrets, port,
 * start command, and ECR authentication settings while updating only the image digest.
 *
 * @param {{ SourceConfiguration?: Record<string, any> }} existingService
 * @param {string} imageUri
 */
export function buildSafeUpdateSourceConfiguration(existingService, imageUri) {
  validateDigestImageUri(imageUri);

  const sourceConfig = existingService?.SourceConfiguration;
  if (!sourceConfig || typeof sourceConfig !== "object") {
    throw new Error("Existing App Runner service is missing SourceConfiguration.");
  }

  if (!sourceConfig.ImageRepository || typeof sourceConfig.ImageRepository !== "object") {
    throw new Error(
      "Existing App Runner service SourceConfiguration is missing ImageRepository (expected ECR image service).",
    );
  }

  const nextSourceConfig = structuredClone(sourceConfig);
  nextSourceConfig.AutoDeploymentsEnabled = false;
  nextSourceConfig.ImageRepository.ImageIdentifier = imageUri.trim();

  return nextSourceConfig;
}

/**
 * Verifies that the RUNNING App Runner service is actually serving the expected
 * immutable digest (catching silent App Runner auto-rollbacks on failed deploys).
 *
 * @param {{ SourceConfiguration?: { ImageRepository?: { ImageIdentifier?: string } } }} service
 * @param {string} expectedImageUri
 */
export function assertDeployedImageDigest(service, expectedImageUri) {
  validateDigestImageUri(expectedImageUri);
  const actual = service?.SourceConfiguration?.ImageRepository?.ImageIdentifier ?? "";
  if (actual.trim() !== expectedImageUri.trim()) {
    throw new Error(
      `App Runner service is running unexpected image (${JSON.stringify(actual)}) instead of requested digest (${JSON.stringify(expectedImageUri)}). The deployment may have failed and auto-rolled back.`,
    );
  }
}

/**
 * Polls `/healthz` and `/readyz` on the deployed App Runner URL until both
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

async function waitForServiceRunning({ serviceArn, region, timeoutMs = 15 * 60 * 1000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { Service } = runAwsJson([
      "apprunner",
      "describe-service",
      "--service-arn",
      serviceArn,
      "--region",
      region,
    ]);

    const status = Service?.Status ?? "UNKNOWN";
    console.log(`[deploy-apprunner] Service status: ${status}`);

    if (status === "RUNNING") {
      return Service;
    }
    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      throw new Error(`App Runner service entered terminal failure state: ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  throw new Error(`Timed out waiting for App Runner service to reach RUNNING state.`);
}

function parseCliArgs(argv) {
  const parsed = {
    serviceArn: process.env.APPRUNNER_SERVICE_ARN ?? "",
    imageUri: process.env.IMAGE_URI ?? "",
    region: process.env.AWS_REGION ?? "us-east-1",
    healthBaseUrl: process.env.HEALTH_BASE_URL ?? "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--service-arn") {
      parsed.serviceArn = argv[++i] ?? "";
    } else if (arg === "--image-uri") {
      parsed.imageUri = argv[++i] ?? "";
    } else if (arg === "--region") {
      parsed.region = argv[++i] ?? "us-east-1";
    } else if (arg === "--health-base-url") {
      parsed.healthBaseUrl = argv[++i] ?? "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export async function deployAppRunnerService({
  serviceArn,
  imageUri,
  region = "us-east-1",
  healthBaseUrl = "",
}) {
  if (!serviceArn) {
    throw new Error("Missing required --service-arn (or APPRUNNER_SERVICE_ARN env var).");
  }
  validateDigestImageUri(imageUri);

  console.log(`[deploy-apprunner] Reading current service configuration in ${region}...`);
  const described = runAwsJson([
    "apprunner",
    "describe-service",
    "--service-arn",
    serviceArn,
    "--region",
    region,
  ]);
  let currentService = described.Service;

  if (currentService?.Status === "PAUSED") {
    console.log("[deploy-apprunner] Service is PAUSED; resuming before updating digest...");
    runAwsJson(["apprunner", "resume-service", "--service-arn", serviceArn, "--region", region]);
    currentService = await waitForServiceRunning({ serviceArn, region });
  }

  const nextSourceConfig = buildSafeUpdateSourceConfiguration(currentService, imageUri);
  const updateInput = JSON.stringify({
    ServiceArn: serviceArn,
    SourceConfiguration: nextSourceConfig,
  });

  console.log(`[deploy-apprunner] Updating service to immutable digest ${imageUri}...`);
  runAwsJson(["apprunner", "update-service", "--region", region, "--cli-input-json", updateInput]);

  const runningService = await waitForServiceRunning({ serviceArn, region });
  assertDeployedImageDigest(runningService, imageUri);

  const resolvedUrl =
    healthBaseUrl || (runningService?.ServiceUrl ? `https://${runningService.ServiceUrl}` : "");

  if (!resolvedUrl) {
    throw new Error("Could not determine App Runner ServiceUrl for health verification.");
  }
  console.log(`[deploy-apprunner] Verifying /healthz and /readyz on ${resolvedUrl}...`);
  await verifyServiceHealth({ baseUrl: resolvedUrl });
  console.log("[deploy-apprunner] Health and readiness probes passed.");

  return {
    serviceArn,
    serviceUrl: resolvedUrl,
    imageUri,
    status: runningService?.Status ?? "RUNNING",
  };
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  deployAppRunnerService(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`[deploy-apprunner] Deploy complete: ${result.serviceUrl} -> ${result.imageUri}`);
    })
    .catch((error) => {
      console.error(
        `[deploy-apprunner] Deploy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    });
}
