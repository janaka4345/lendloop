import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, deriveClerkOrigin } from "@/lib/security-headers";

const VALID_CLERK_PK = `pk_test_${Buffer.from("clerk.lendloop.dev$").toString("base64")}`;

describe("OWASP security headers and runtime-derived CSP", () => {
  it("derives the Clerk origin from CLERK_PUBLISHABLE_KEY when CLERK_FRONTEND_API_URL is unset", () => {
    expect(deriveClerkOrigin({ CLERK_PUBLISHABLE_KEY: VALID_CLERK_PK })).toBe(
      "https://clerk.lendloop.dev",
    );
  });

  it("prefers explicit CLERK_FRONTEND_API_URL over publishable key derivation", () => {
    expect(
      deriveClerkOrigin({
        CLERK_PUBLISHABLE_KEY: VALID_CLERK_PK,
        CLERK_FRONTEND_API_URL: "https://auth.custom.lendloop.dev/path",
      }),
    ).toBe("https://auth.custom.lendloop.dev");
  });

  it("attaches all required OWASP headers and runtime-derived CSP directives", () => {
    const headers = buildSecurityHeaders(
      {
        NODE_ENV: "production",
        APP_URL: "https://app.lendloop.dev",
        CONVEX_URL: "https://happy-otter-123.convex.cloud",
        CLERK_PUBLISHABLE_KEY: VALID_CLERK_PK,
        SENTRY_DSN: "https://key@o12345.ingest.us.sentry.io/67890",
      },
      { isHttpsRequest: true },
    );

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");

    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://clerk.lendloop.dev");
    expect(csp).toContain("https://happy-otter-123.convex.cloud");
    expect(csp).toContain("wss://happy-otter-123.convex.cloud");
    expect(csp).toContain("https://o12345.ingest.us.sentry.io");
    expect(csp).toMatch(
      /script-src [^;]*https:\/\/clerk\.lendloop\.dev[^;]*https:\/\/\*\.protect\.clerk\.com[^;]*https:\/\/challenges\.cloudflare\.com/,
    );
    expect(csp).toMatch(
      /connect-src [^;]*https:\/\/clerk\.lendloop\.dev[^;]*https:\/\/\*\.protect\.clerk\.com:\*/,
    );
    expect(csp).toMatch(
      /img-src [^;]*'self'[^;]*blob:[^;]*data:[^;]*https:\/\/happy-otter-123\.convex\.cloud[^;]*https:\/\/clerk\.lendloop\.dev[^;]*https:\/\/img\.clerk\.com/,
    );
    expect(csp).toMatch(
      /frame-src [^;]*'self'[^;]*https:\/\/challenges\.cloudflare\.com[^;]*https:\/\/\*\.protect\.clerk\.com/,
    );
  });

  it("omits Clerk-specific CSP origins when Clerk is not configured", () => {
    const headers = buildSecurityHeaders(
      {
        NODE_ENV: "production",
        APP_URL: "https://app.lendloop.dev",
        CONVEX_URL: "https://happy-otter-123.convex.cloud",
      },
      { isHttpsRequest: true },
    );

    const csp = headers["Content-Security-Policy"];
    expect(csp).not.toContain("protect.clerk.com");
    expect(csp).not.toContain("img.clerk.com");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(csp).toContain("frame-src 'self'");
  });

  it("omits Strict-Transport-Security and Sentry origin in local HTTP environments", () => {
    const headers = buildSecurityHeaders(
      {
        NODE_ENV: "production",
        APP_URL: "http://localhost:3000",
        CONVEX_URL: "http://127.0.0.1:3210",
        CLERK_PUBLISHABLE_KEY: VALID_CLERK_PK,
      },
      { isHttpsRequest: false },
    );

    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("http://127.0.0.1:3210");
    expect(csp).toContain("ws://127.0.0.1:3210");
    expect(csp).not.toContain("sentry.io");
  });
});
