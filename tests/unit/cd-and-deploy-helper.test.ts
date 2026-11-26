import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDeployedImageDigest,
  buildSafeUpdateSourceConfiguration,
  validateDigestImageUri,
  verifyServiceHealth,
} from "../../scripts/deploy-apprunner.mjs";

const VALID_DIGEST = "sha256:" + "a".repeat(64);
const VALID_ECR_URI = `123456789012.dkr.ecr.us-east-1.amazonaws.com/lendloop-web@${VALID_DIGEST}`;

describe("App Runner read-modify-write deploy helper", () => {
  describe("validateDigestImageUri", () => {
    it("accepts a valid ECR digest-pinned image URI", () => {
      expect(() => validateDigestImageUri(VALID_ECR_URI)).not.toThrow();
    });

    it("rejects mutable tags and malformed digests", () => {
      expect(() =>
        validateDigestImageUri("123456789012.dkr.ecr.us-east-1.amazonaws.com/lendloop-web:latest"),
      ).toThrow(/digest/i);
      expect(() =>
        validateDigestImageUri("123456789012.dkr.ecr.us-east-1.amazonaws.com/lendloop-web:main"),
      ).toThrow(/digest/i);
      expect(() =>
        validateDigestImageUri(
          "123456789012.dkr.ecr.us-east-1.amazonaws.com/lendloop-web@sha256:1234",
        ),
      ).toThrow(/digest/i);
      expect(() => validateDigestImageUri("")).toThrow(/digest/i);
    });
  });

  describe("buildSafeUpdateSourceConfiguration", () => {
    it("replaces only ImageIdentifier while preserving SSM secrets, env vars, port, and auth config", () => {
      const existingService = {
        ServiceArn: "arn:aws:apprunner:us-east-1:123456789012:service/lendloop-dev/abc",
        ServiceUrl: "abc.us-east-1.awsapprunner.com",
        Status: "RUNNING",
        SourceConfiguration: {
          AutoDeploymentsEnabled: true,
          AuthenticationConfiguration: {
            AccessRoleArn: "arn:aws:iam::123456789012:role/lendloop-apprunner-ecr-access",
          },
          ImageRepository: {
            ImageIdentifier: `123456789012.dkr.ecr.us-east-1.amazonaws.com/lendloop-web@sha256:${"b".repeat(64)}`,
            ImageRepositoryType: "ECR",
            ImageConfiguration: {
              Port: "3000",
              RuntimeEnvironmentVariables: {
                APP_ENV: "dev",
                APP_URL: "https://dev.lendloop.example.com",
                CONVEX_URL: "https://dev-example.convex.cloud",
              },
              RuntimeEnvironmentSecrets: {
                CLERK_SECRET_KEY:
                  "arn:aws:ssm:us-east-1:123456789012:parameter/lendloop/dev/CLERK_SECRET_KEY",
                CLERK_PUBLISHABLE_KEY:
                  "arn:aws:ssm:us-east-1:123456789012:parameter/lendloop/dev/CLERK_PUBLISHABLE_KEY",
              },
            },
          },
        },
      };

      const snapshotBefore = structuredClone(existingService);
      const updated = buildSafeUpdateSourceConfiguration(existingService, VALID_ECR_URI);

      // Must not mutate the input object
      expect(existingService).toEqual(snapshotBefore);

      // Replaces only ImageIdentifier and disables auto-deployments (digest-promoted)
      expect(updated.ImageRepository.ImageIdentifier).toBe(VALID_ECR_URI);
      expect(updated.AutoDeploymentsEnabled).toBe(false);

      // Preserves all existing configuration intact
      expect(updated.AuthenticationConfiguration).toEqual(
        existingService.SourceConfiguration.AuthenticationConfiguration,
      );
      expect(updated.ImageRepository.ImageRepositoryType).toBe("ECR");
      expect(updated.ImageRepository.ImageConfiguration).toEqual(
        existingService.SourceConfiguration.ImageRepository.ImageConfiguration,
      );
    });

    it("throws when SourceConfiguration.ImageRepository is missing", () => {
      expect(() =>
        buildSafeUpdateSourceConfiguration({ SourceConfiguration: {} }, VALID_ECR_URI),
      ).toThrow(/ImageRepository/i);
    });
  });

  describe("assertDeployedImageDigest", () => {
    it("passes when the running service serves the exact expected digest", () => {
      expect(() =>
        assertDeployedImageDigest(
          {
            SourceConfiguration: {
              ImageRepository: { ImageIdentifier: VALID_ECR_URI, ImageRepositoryType: "ECR" },
            },
          },
          VALID_ECR_URI,
        ),
      ).not.toThrow();
    });

    it("throws when App Runner silently auto-rolled back to a previous digest", () => {
      const previousUri = `123456789012.dkr.ecr.us-east-1.amazonaws.com/lendloop-web@sha256:${"b".repeat(64)}`;
      expect(() =>
        assertDeployedImageDigest(
          {
            SourceConfiguration: {
              ImageRepository: { ImageIdentifier: previousUri, ImageRepositoryType: "ECR" },
            },
          },
          VALID_ECR_URI,
        ),
      ).toThrow(/auto-rolled back/i);
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
        baseUrl: "https://dev.example.awsapprunner.com/",
        fetchImpl: mockFetch,
        maxAttempts: 3,
        delayMs: 0,
      });

      expect(calls).toEqual([
        "https://dev.example.awsapprunner.com/healthz",
        "https://dev.example.awsapprunner.com/readyz",
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
        baseUrl: "https://dev.example.awsapprunner.com",
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
          baseUrl: "https://dev.example.awsapprunner.com",
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
    it(`${file} pins every GitHub Action to a 40-char commit SHA and defaults permissions to contents: read`, () => {
      const fullPath = path.resolve(process.cwd(), ".github", "workflows", file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const raw = fs.readFileSync(fullPath, "utf8");

      expect(raw).toMatch(/^permissions:\s*\r?\n\s+contents:\s*read\b/m);

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
    expect(raw).toContain("scripts/deploy-apprunner.mjs");
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
