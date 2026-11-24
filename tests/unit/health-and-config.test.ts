import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getHealthz } from "@/app/healthz/route";
import { GET as getReadyz } from "@/app/readyz/route";
import { GET as getConfig } from "@/app/api/config/route";

const VALID_CLERK_PK = `pk_test_${Buffer.from("clerk.lendloop.dev$").toString("base64")}`;

const VALID_ENV = {
  APP_URL: "https://app.lendloop.dev",
  CONVEX_URL: "https://happy-otter-123.convex.cloud",
  CLERK_PUBLISHABLE_KEY: VALID_CLERK_PK,
  CLERK_SECRET_KEY: "sk_test_super_secret_value_do_not_leak",
  APP_ENV: "dev",
  SENTRY_DSN: "https://publicKey@o12345.ingest.us.sentry.io/67890",
};

describe("health, readiness, and runtime config endpoints", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APP_URL;
    delete process.env.CONVEX_URL;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_FRONTEND_API_URL;
    delete process.env.SENTRY_DSN;
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("GET /healthz unconditionally returns 200 { status: 'ok' } even without env vars", async () => {
    const response = await getHealthz();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /readyz returns 200 { status: 'ready' } with zero outbound network calls when config is valid", async () => {
    Object.assign(process.env, VALID_ENV);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await getReadyz();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GET /readyz returns 503 with missing/invalid field names and never leaks secret values", async () => {
    process.env.APP_URL = "not-a-url";
    process.env.CONVEX_URL = "ftp://invalid.example.com";
    process.env.CLERK_PUBLISHABLE_KEY = "bad_key";
    process.env.CLERK_SECRET_KEY = "invalid_secret_token_xyz";

    const response = await getReadyz();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string; errors: string[] };
    expect(body.status).toBe("not_ready");
    expect(body.errors.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(body)).not.toContain("invalid_secret_token_xyz");
  });

  it("GET /api/config returns non-secret runtime client config with Cache-Control: no-store", async () => {
    Object.assign(process.env, VALID_ENV);

    const response = await getConfig();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      appUrl: VALID_ENV.APP_URL,
      convexUrl: VALID_ENV.CONVEX_URL,
      clerkPublishableKey: VALID_ENV.CLERK_PUBLISHABLE_KEY,
      sentryDsn: VALID_ENV.SENTRY_DSN,
      environment: "dev",
    });
    expect(JSON.stringify(body)).not.toContain(VALID_ENV.CLERK_SECRET_KEY);
  });

  it("GET /api/config omits sentryDsn as null when SENTRY_DSN is unset", async () => {
    Object.assign(process.env, { ...VALID_ENV, SENTRY_DSN: "" });

    const response = await getConfig();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.sentryDsn).toBeNull();
  });

  it("GET /api/config returns 503 when required runtime config is missing", async () => {
    const response = await getConfig();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
