import { describe, expect, it } from "vitest";
import { computeRetryDelayMs, shouldRetryHttpStatus } from "./retry";

describe("Bounded exponential retry backoff with +/-20% jitter", () => {
  it("computes exponential backoff with zero jitter at midpoint random = 0.5", () => {
    const mid = () => 0.5;
    expect(computeRetryDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 30_000, random: mid })).toBe(
      1000,
    );
    expect(computeRetryDelayMs(2, { baseDelayMs: 1000, maxDelayMs: 30_000, random: mid })).toBe(
      2000,
    );
    expect(computeRetryDelayMs(3, { baseDelayMs: 1000, maxDelayMs: 30_000, random: mid })).toBe(
      4000,
    );
  });

  it("applies +/-20% jitter and enforces maxDelayMs cap", () => {
    expect(computeRetryDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 30_000, random: () => 0 })).toBe(
      800,
    );
    expect(computeRetryDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 30_000, random: () => 1 })).toBe(
      1200,
    );
    // Very high attempt is capped at maxDelayMs
    expect(
      computeRetryDelayMs(10, { baseDelayMs: 1000, maxDelayMs: 5000, random: () => 1 }),
    ).toBeLessThanOrEqual(5000);
    expect(computeRetryDelayMs(10, { baseDelayMs: 1000, maxDelayMs: 5000, random: () => 0 })).toBe(
      4000,
    );
  });

  it("throws on invalid attempt numbers (< 1)", () => {
    expect(() => computeRetryDelayMs(0)).toThrow();
    expect(() => computeRetryDelayMs(-1)).toThrow();
  });

  it("retries transient 429/5xx/network failures up to maxAttempts and fails fast on 400/401/403", () => {
    expect(shouldRetryHttpStatus(500, 1, 3)).toBe(true);
    expect(shouldRetryHttpStatus(503, 2, 3)).toBe(true);
    expect(shouldRetryHttpStatus(429, 1, 3)).toBe(true);
    expect(shouldRetryHttpStatus(0, 1, 3)).toBe(true); // network error
    expect(shouldRetryHttpStatus(500, 3, 3)).toBe(false); // exhausted
    expect(shouldRetryHttpStatus(400, 1, 3)).toBe(false);
    expect(shouldRetryHttpStatus(401, 1, 3)).toBe(false);
    expect(shouldRetryHttpStatus(403, 1, 3)).toBe(false);
    expect(shouldRetryHttpStatus(404, 1, 3)).toBe(false);
  });
});
