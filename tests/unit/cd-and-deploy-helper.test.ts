import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDeployedImageDigest,
  buildSafeUpdatePrimaryContainer,
  resolveExpressServiceUrl,
  validateDigestImageUri,
  verifyServiceHealth,
} from "../../scripts/deploy-ecs-express.mjs";

const VALID_DIGEST = "sha256:" + "a".repeat(64);
const VALID_ECR_URI = `041459489381.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@${VALID_DIGEST}`;

describe("ECS Express Mode read-modify-write deploy helper", () => {
  describe("validateDigestImageUri", () => {
    it("accepts a valid ECR digest-pinned image URI", () => {
      expect(() => validateDigestImageUri(VALID_ECR_URI)).not.toThrow();
    });

    it("rejects mutable tags and malformed digests", () => {
      expect(() =>
        validateDigestImageUri(
          "041459489381.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web:latest",
        ),
      ).toThrow(/digest/i);
      expect(() =>
        validateDigestImageUri(
          "041459489381.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web:main",
        ),
      ).toThrow(/digest/i);
      expect(() =>
        validateDigestImageUri(
          "041459489381.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:1234",
        ),
      ).toThrow(/digest/i);
      expect(() => validateDigestImageUri("")).toThrow(/digest/i);
    });
  });

  describe("buildSafeUpdatePrimaryContainer", () => {
    it("replaces only image while preserving SSM secrets, env vars, port, and log config", () => {
      const existingService = {
        serviceArn: "arn:aws:ecs:ap-southeast-2:041459489381:service/default/lendloop-dev",
        serviceName: "lendloop-dev",
        cluster: "default",
        status: { statusCode: "ACTIVE" },
        activeConfigurations: [
          {
            createdAt: 1_700_000_000,
            ingressPaths: [{ accessType: "PUBLIC", endpoint: "lendloop-dev.ap-southeast-2.ecs.aws" }],
            primaryContainer: {
              image: `041459489381.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:${"b".repeat(64)}`,
              containerPort: 3000,
              awsLogsConfiguration: {
                logGroup: "/aws/ecs/express/lendloop-dev",
                logStreamPrefix: "web",
              },
              environment: [
                { name: "APP_ENV", value: "dev" },
                { name: "APP_URL", value: "https://lendloop-dev.ap-southeast-2.ecs.aws" },
                { name: "CONVEX_URL", value: "https://adventurous-bulldog-441.convex.cloud" },
              ],
              secrets: [
                {
                  name: "CLERK_SECRET_KEY",
                  valueFrom:
                    "arn:aws:ssm:ap-southeast-2:041459489381:parameter/lendloop/dev/CLERK_SECRET_KEY",
                },
                {
                  name: "CLERK_PUBLISHABLE_KEY",
                  valueFrom:
                    "arn:aws:ssm:ap-southeast-2:041459489381:parameter/lendloop/dev/CLERK_PUBLISHABLE_KEY",
                },
              ],
            },
          },
        ],
      };

      const snapshotBefore = structuredClone(existingService);
      const updated = buildSafeUpdatePrimaryContainer(existingService, VALID_ECR_URI);

      // Must not mutate the input object
      expect(existingService).toEqual(snapshotBefore);

      // Replaces only image
      expect(updated.image).toBe(VALID_ECR_URI);

      // Preserves all existing configuration intact
      const originalContainer = existingService.activeConfigurations[0].primaryContainer;
      expect(updated.containerPort).toBe(3000);
      expect(updated.awsLogsConfiguration).toEqual(originalContainer.awsLogsConfiguration);
      expect(updated.environment).toEqual(originalContainer.environment);
      expect(updated.secrets).toEqual(originalContainer.secrets);
    });

    it("throws when activeConfigurations or primaryContainer is missing", () => {
      expect(() =>
        buildSafeUpdatePrimaryContainer({ activeConfigurations: [] }, VALID_ECR_URI),
      ).toThrow(/activeConfigurations/i);
      expect(() =>
        buildSafeUpdatePrimaryContainer({ activeConfigurations: [{}] }, VALID_ECR_URI),
      ).toThrow(/primaryContainer/i);
    });
  });

  describe("assertDeployedImageDigest", () => {
    it("passes when the active service serves the exact expected digest", () => {
      expect(() =>
        assertDeployedImageDigest(
          {
            activeConfigurations: [
              {
                createdAt: 1_700_000_000,
                primaryContainer: { image: VALID_ECR_URI },
              },
            ],
          },
          VALID_ECR_URI,
        ),
      ).not.toThrow();
    });

    it("throws when ECS silently auto-rolled back to a previous digest", () => {
      const previousUri = `041459489381.dkr.ecr.ap-southeast-2.amazonaws.com/lendloop-web@sha256:${"b".repeat(64)}`;
      expect(() =>
        assertDeployedImageDigest(
          {
            activeConfigurations: [
              {
                createdAt: 1_700_000_000,
                primaryContainer: { image: previousUri },
              },
            ],
          },
          VALID_ECR_URI,
        ),
      ).toThrow(/auto-rolled back/i);
    });
  });

  describe("resolveExpressServiceUrl", () => {
    it("resolves https URL from ingressPaths endpoint", () => {
      expect(
        resolveExpressServiceUrl({
          activeConfigurations: [
            {
              ingressPaths: [{ accessType: "PUBLIC", endpoint: "lendloop-dev.ecs.aws" }],
            },
          ],
        }),
      ).toBe("https://lendloop-dev.ecs.aws");
    });
  });

  describe("verifyServiceHealth", () => {
    it("succeeds when /healthz and /readyz return 200 OK", async () => {
      const calls: string[] = [];
      const mockFetch = async (url: string) => {
        calls.push(url);
        if (url.endsWith("/healthz")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
      };

      await verifyServiceHealth({
        baseUrl: "https://dev.example.ecs.aws/",
        fetchImpl: mockFetch,
        maxAttempts: 3,
        delayMs: 0,
      });

      expect(calls).toEqual([
        "https://dev.example.ecs.aws/healthz",
        "https://dev.example.ecs.aws/readyz",
      ]);
    });

    it("retries transient 503 responses before succeeding", async () => {
      let readyAttempts = 0;
      const mockFetch = async (url: string) => {
        if (url.endsWith("/healthz")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        readyAttempts += 1;
        if (readyAttempts < 2) {
          return new Response(JSON.stringify({ status: "not_ready" }), { status: 503 });
        }
        return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
      };

      await verifyServiceHealth({
        baseUrl: "https://dev.example.ecs.aws",
        fetchImpl: mockFetch,
        maxAttempts: 3,
        delayMs: 0,
      });

      expect(readyAttempts).toBe(2);
    });

    it("fails with a clear error when /readyz never becomes healthy", async () => {
      const mockFetch = async (url: string) => {
        if (url.endsWith("/healthz")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: "not_ready" }), { status: 503 });
      };

      await expect(
        verifyServiceHealth({
          baseUrl: "https://dev.example.ecs.aws",
          fetchImpl: mockFetch,
          maxAttempts: 2,
          delayMs: 0,
        }),
      ).rejects.toThrow(/\/readyz/i);
    });
  });
});

describe("AWS CD workflows & published-digest Compose contract", () => {
  const workflowFiles = ["cd.yml", "promote.yml"];

  for (const file of workflowFiles) {
    it(`${file} pins every GitHub Action to a 40-char commit SHA, targets ap-southeast-2, and defaults permissions to contents: read`, () => {
      const fullPath = path.resolve(process.cwd(), ".github", "workflows", file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const raw = fs.readFileSync(fullPath, "utf8");

      expect(raw).toMatch(/^permissions:\s*\r?\n\s+contents:\s*read\b/m);
      expect(raw).toContain("AWS_REGION: ap-southeast-2");

      const usesMatches = [...raw.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
      expect(usesMatches.length).toBeGreaterThan(0);
      for (const actionRef of usesMatches) {
        expect(actionRef).toMatch(/^[^@]+@[a-f0-9]{40}$/);
      }
    });
  }

  it("promote.yml defines sequential qa -> staging -> prod promotion and rollback mode", () => {
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), ".github", "workflows", "promote.yml"),
      "utf8",
    );
    expect(raw).toContain("environment: qa");
    expect(raw).toContain("environment: staging");
    expect(raw).toContain("environment: prod");
    expect(raw).toContain("rollback");
    expect(raw).toContain("scripts/deploy-ecs-express.mjs");
  });

  it("docker-compose.published.yml pulls an immutable digest image without building locally", () => {
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), "docker-compose.published.yml"),
      "utf8",
    );
    expect(raw).toContain("LENDLOOP_IMAGE");
    expect(raw).toContain("pull_policy: always");
    expect(raw).not.toMatch(/^\s+build:/m);
  });
});
