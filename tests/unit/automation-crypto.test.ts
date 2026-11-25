import { describe, expect, it } from "vitest";
import {
  sha256Hex,
  signAutomationJwt,
  verifyAutomationJwt,
  verifyServiceToken,
} from "../../convex/automation/crypto";

describe("Automation crypto helpers (HS256 JWT, bodySha256, constant-time token verification)", () => {
  const SECRET = "local-dev-jwt-secret-for-unit-tests-only-32chars";

  it("computes deterministic lowercase SHA-256 hex digest", async () => {
    const hash = await sha256Hex('{"hello":"world"}');
    expect(hash).toBe("93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588");
  });

  it("mints a 60-second HS256 JWT with iss, aud, jti, bodySha256 and verifies it against exact rawBody", async () => {
    const rawBody = JSON.stringify({ eventId: "loan_requested:abc", loanId: "abc" });
    const bodySha256 = await sha256Hex(rawBody);
    const nowSeconds = 1_750_000_000;

    const token = await signAutomationJwt({
      secret: SECRET,
      jti: "loan_requested:abc",
      bodySha256,
      nowSeconds,
    });

    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const verified = await verifyAutomationJwt({
      token,
      secret: SECRET,
      rawBody,
      nowSeconds: nowSeconds + 30,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.iss).toBe("convex");
      expect(verified.payload.aud).toBe("n8n-automation");
      expect(verified.payload.jti).toBe("loan_requested:abc");
      expect(verified.payload.bodySha256).toBe(bodySha256);
      expect(verified.payload.exp - verified.payload.iat).toBe(60);
    }
  });

  it("rejects tampered body, wrong secret, expired token, or mismatched iss/aud", async () => {
    const rawBody = JSON.stringify({ eventId: "evt_1" });
    const bodySha256 = await sha256Hex(rawBody);
    const nowSeconds = 1_750_000_000;

    const token = await signAutomationJwt({
      secret: SECRET,
      jti: "evt_1",
      bodySha256,
      nowSeconds,
    });

    const tamperedBody = await verifyAutomationJwt({
      token,
      secret: SECRET,
      rawBody: JSON.stringify({ eventId: "evt_2" }),
      nowSeconds: nowSeconds + 10,
    });
    expect(tamperedBody).toEqual({ ok: false, code: "BODY_HASH_MISMATCH" });

    const wrongSecret = await verifyAutomationJwt({
      token,
      secret: "different-secret-value-for-test-only",
      rawBody,
      nowSeconds: nowSeconds + 10,
    });
    expect(wrongSecret).toEqual({ ok: false, code: "INVALID_SIGNATURE" });

    const expired = await verifyAutomationJwt({
      token,
      secret: SECRET,
      rawBody,
      nowSeconds: nowSeconds + 61,
    });
    expect(expired).toEqual({ ok: false, code: "TOKEN_EXPIRED" });

    const wrongAud = await verifyAutomationJwt({
      token,
      secret: SECRET,
      rawBody,
      nowSeconds: nowSeconds + 10,
      expectedAud: "other-audience",
    });
    expect(wrongAud).toEqual({ ok: false, code: "INVALID_CLAIMS" });
  });

  it("verifies X-N8N-Service-Token in constant time with PREVIOUS rotation support", async () => {
    const current = "current-service-token-value-12345";
    const previous = "previous-service-token-value-67890";

    expect(await verifyServiceToken(current, current, previous)).toEqual({
      valid: true,
      usedPrevious: false,
    });
    expect(await verifyServiceToken(previous, current, previous)).toEqual({
      valid: true,
      usedPrevious: true,
    });
    expect(await verifyServiceToken("wrong-token", current, previous)).toEqual({
      valid: false,
      usedPrevious: false,
    });
    expect(await verifyServiceToken(null, current, previous)).toEqual({
      valid: false,
      usedPrevious: false,
    });
    expect(await verifyServiceToken("", current, previous)).toEqual({
      valid: false,
      usedPrevious: false,
    });
    expect(await verifyServiceToken(current, undefined, undefined)).toEqual({
      valid: false,
      usedPrevious: false,
    });
  });
});
