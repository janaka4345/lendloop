import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { REDACTED } from "@/domain/redaction";
import {
  buildSentryInitOptions,
  resolveSentryDsn,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from "@/lib/sentry";

const SYNTHETIC_DSN = "https://publickey@o123456.ingest.us.sentry.io/789012";

describe("runtime-optional Sentry configuration", () => {
  it("returns null from resolveSentryDsn when unset, blank, or invalid", () => {
    expect(resolveSentryDsn(undefined)).toBeNull();
    expect(resolveSentryDsn(null)).toBeNull();
    expect(resolveSentryDsn("")).toBeNull();
    expect(resolveSentryDsn("   ")).toBeNull();
    expect(resolveSentryDsn("not-a-url")).toBeNull();
    expect(resolveSentryDsn("ftp://invalid.sentry.io/1")).toBeNull();
  });

  it("returns a trimmed DSN for valid http(s) Sentry DSNs", () => {
    expect(resolveSentryDsn(`  ${SYNTHETIC_DSN}  `)).toBe(SYNTHETIC_DSN);
  });

  it("returns null from buildSentryInitOptions when SENTRY_DSN is unset (clean no-op)", () => {
    expect(buildSentryInitOptions({ dsn: undefined, environment: "local" })).toBeNull();
    expect(buildSentryInitOptions({ dsn: "", environment: "prod" })).toBeNull();
  });

  it("builds safe init options with sendDefaultPii: false when SENTRY_DSN is set", () => {
    const options = buildSentryInitOptions({
      dsn: SYNTHETIC_DSN,
      environment: "staging",
      nodeEnv: "production",
    });

    expect(options).not.toBeNull();
    expect(options?.dsn).toBe(SYNTHETIC_DSN);
    expect(options?.enabled).toBe(true);
    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.environment).toBe("staging");
    expect(options?.tracesSampleRate).toBe(0.1);
    expect(typeof options?.beforeSend).toBe("function");
    expect(typeof options?.beforeBreadcrumb).toBe("function");
  });

  it("scrubs sensitive headers, cookies, user PII, emails, and tokens from Sentry events", () => {
    const rawEvent: ErrorEvent = {
      type: undefined,
      message:
        "Auth failed for alice@example.com with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
      user: {
        id: "user_123",
        email: "alice@example.com",
        ip_address: "203.0.113.42",
        username: "alice",
      },
      request: {
        url: "https://lendloop.example.com/api/test?token=sk_test_super_secret_value_do_not_leak",
        cookies: { __session: "secret-cookie" },
        headers: {
          Authorization: "Bearer super-secret-jwt",
          Cookie: "__session=abc",
          "X-N8N-Service-Token": "top-secret-token",
          "Svix-Signature": "v1,signature",
          "Content-Type": "application/json",
          "X-Request-Id": "req-123",
        },
        data: {
          email: "bob@example.com",
          note: "Contact bob@example.com",
        },
      },
      exception: {
        values: [
          {
            type: "Error",
            value: "Rejected key sk_test_super_secret_value_do_not_leak for bob@example.com",
          },
        ],
      },
      extra: {
        clerkSecret: "sk_live_abc123456789",
        safeCount: 3,
      },
      tags: {
        detail: "owner alice@example.com",
      },
    };

    const scrubbed = scrubSentryEvent(rawEvent);

    expect(scrubbed.message).not.toContain("alice@example.com");
    expect(scrubbed.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(scrubbed.message).toContain(REDACTED);

    expect(scrubbed.user).toEqual({ id: "user_123" });

    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.headers?.Authorization).toBe(REDACTED);
    expect(scrubbed.request?.headers?.Cookie).toBe(REDACTED);
    expect(scrubbed.request?.headers?.["X-N8N-Service-Token"]).toBe(REDACTED);
    expect(scrubbed.request?.headers?.["Svix-Signature"]).toBe(REDACTED);
    expect(scrubbed.request?.headers?.["Content-Type"]).toBe("application/json");
    expect(scrubbed.request?.headers?.["X-Request-Id"]).toBe("req-123");
    expect(scrubbed.request?.url).not.toContain("sk_test_super_secret_value_do_not_leak");
    expect(scrubbed.request?.data).toEqual({
      email: REDACTED,
      note: `Contact ${REDACTED}`,
    });

    const exValue = scrubbed.exception?.values?.[0]?.value ?? "";
    expect(exValue).not.toContain("sk_test_super_secret_value_do_not_leak");
    expect(exValue).not.toContain("bob@example.com");

    expect(scrubbed.extra).toEqual({
      clerkSecret: REDACTED,
      safeCount: 3,
    });
    expect(scrubbed.tags?.detail).toBe(`owner ${REDACTED}`);
  });

  it("scrubs sensitive data from breadcrumbs", () => {
    const breadcrumb: Breadcrumb = {
      category: "http",
      message: "POST /webhook for user@example.com",
      data: {
        authorization: "Bearer abc123",
        url: "https://example.com?secret=sk_test_super_secret_value_do_not_leak",
        status_code: 500,
      },
    };

    const scrubbed = scrubSentryBreadcrumb(breadcrumb);
    expect(scrubbed.message).toBe(`POST /webhook for ${REDACTED}`);
    expect(scrubbed.data).toEqual({
      authorization: REDACTED,
      url: `https://example.com?secret=${REDACTED}`,
      status_code: 500,
    });
  });
});
