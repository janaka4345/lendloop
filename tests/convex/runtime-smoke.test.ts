import { describe, expect, it } from "vitest";

describe("convex edge-runtime Vitest project", () => {
  it("executes in an edge-runtime environment with Web Crypto available", async () => {
    expect(typeof crypto?.subtle?.digest).toBe("function");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lendloop"));
    expect(digest.byteLength).toBe(32);
  });
});
