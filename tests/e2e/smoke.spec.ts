import { expect, test } from "@playwright/test";

test.describe("Commit-1 container smoke suite", () => {
  test("GET /healthz returns 200 ok", async ({ request }) => {
    const response = await request.get("/healthz");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("GET /readyz returns 200 ready", async ({ request }) => {
    const response = await request.get("/readyz");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  test("GET /api/config returns non-secret runtime config with Cache-Control: no-store", async ({
    request,
  }) => {
    const response = await request.get("/api/config");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");

    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.appUrl).toBe("string");
    expect(typeof body.convexUrl).toBe("string");
    expect(typeof body.clerkPublishableKey).toBe("string");
    expect(JSON.stringify(body)).not.toContain("sk_test_");
    expect(JSON.stringify(body)).not.toContain("sk_live_");
  });

  test("root page renders cleanly with OWASP headers, runtime CSP, and zero console/page errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    const headers = response!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");

    await expect(page.getByRole("heading", { name: "LendLoop" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to lend or borrow" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
