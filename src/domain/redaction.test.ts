import { describe, expect, it } from "vitest";
import {
  REDACTED,
  formatStructuredLog,
  redactText,
  redactValue,
  sanitizeAuditMetadata,
} from "./redaction";

describe("PII and secret redaction", () => {
  it("redacts emails, bearer tokens, JWTs, Clerk keys, and webhook secrets in free text", () => {
    const sample =
      "User alice@example.com sent Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig123 with sk_live_abc123456789 and whsec_secretvalue123";
    const redacted = redactText(sample);
    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).not.toContain("sk_live_abc123456789");
    expect(redacted).not.toContain("whsec_secretvalue123");
    expect(redacted).toContain(REDACTED);
  });

  it("recursively redacts sensitive object keys while preserving safe fields", () => {
    const input = {
      action: "loan.approved",
      email: "neighbor@example.com",
      externalId: "user_2abc123",
      nested: {
        authorization: "Bearer secret-token",
        count: 2,
        note: "Contact bob@example.com",
      },
      tags: ["safe", "carol@example.com"],
    };

    const output = redactValue(input) as Record<string, unknown>;
    expect(output.action).toBe("loan.approved");
    expect(output.email).toBe(REDACTED);
    expect(output.externalId).toBe(REDACTED);
    expect((output.nested as Record<string, unknown>).authorization).toBe(REDACTED);
    expect((output.nested as Record<string, unknown>).count).toBe(2);
    expect((output.nested as Record<string, unknown>).note).toBe(`Contact ${REDACTED}`);
    expect(output.tags).toEqual(["safe", REDACTED]);
  });

  it("sanitizes Audit Log metadata to strip PII keys and redact strings", () => {
    expect(sanitizeAuditMetadata(undefined)).toBeUndefined();
    const clean = sanitizeAuditMetadata({
      previousRole: "user",
      nextRole: "admin",
      email: "admin@example.com",
      displayName: "Alice",
      externalId: "user_123",
      reason: "Promoted by ops@example.com",
      archivedListingCount: 3,
      trustedLender: true,
    });
    expect(clean).toEqual({
      previousRole: "user",
      nextRole: "admin",
      reason: `Promoted by ${REDACTED}`,
      archivedListingCount: 3,
      trustedLender: true,
    });
  });

  it("emits single-line JSON structured logs with redacted context", () => {
    const line = formatStructuredLog({
      level: "warn",
      event: "authz.forbidden",
      code: "FORBIDDEN",
      context: { email: "leak@example.com", targetType: "listing" },
      timestamp: "2026-05-10T12:00:00.000Z",
    });
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("warn");
    expect(parsed.event).toBe("authz.forbidden");
    expect(parsed.code).toBe("FORBIDDEN");
    expect((parsed.context as Record<string, unknown>).email).toBe(REDACTED);
    expect((parsed.context as Record<string, unknown>).targetType).toBe("listing");
  });
});
