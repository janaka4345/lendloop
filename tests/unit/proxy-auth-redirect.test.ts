import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.APP_URL = "http://localhost:3000";
  process.env.CONVEX_URL = "http://127.0.0.1:3210";
  process.env.CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsuY2kubGVuZGxvb3AubG9jYWwk";
  process.env.CLERK_SECRET_KEY = "sk_test_ci_synthetic_non_secret_placeholder";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function createFakeEvent(): NextFetchEvent {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as NextFetchEvent;
}

describe("Next.js Clerk auth proxy and protected deep-link redirects", () => {
  it("redirects unauthenticated visitors from protected deep-links to /sign-in with redirect_url preserved", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost:3000/listings/abc123?tab=schedule");
    const response = await proxy(request, createFakeEvent());

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe(
      "http://localhost:3000/sign-in?redirect_url=%2Flistings%2Fabc123%3Ftab%3Dschedule",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("allows unauthenticated browser visitors on public routes with security headers and no handshake redirect", async () => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/", "/healthz", "/readyz", "/api/config", "/sign-in"]) {
      const request = new NextRequest(`http://localhost:3000${path}`, {
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      const response = await proxy(request, createFakeEvent());
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("returns 401 JSON for unauthenticated requests to protected API routes", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost:3000/api/uploads/listing-image", {
      method: "POST",
    });
    const response = await proxy(request, createFakeEvent());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication is required." });
  });

  it("redirects signed-in Users visiting / straight to /listings", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("clerk.example.com$").toString("base64")}`;
    vi.doMock("@clerk/nextjs/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
      return {
        ...actual,
        clerkMiddleware:
          (
            handler: (
              auth: () => Promise<{ userId: string }>,
              req: NextRequest,
            ) => Promise<Response>,
          ) =>
          (req: NextRequest) =>
            handler(async () => ({ userId: "user_signed_in" }), req),
      };
    });

    const { proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost:3000/");
    const response = await proxy(request, createFakeEvent());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/listings");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    vi.doUnmock("@clerk/nextjs/server");
  });
});
