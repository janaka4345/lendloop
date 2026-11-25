import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { verifyAutomationJwt } from "../../convex/automation/crypto";
import { createTestBackend } from "./test-helpers";

const TEST_JWT_SECRET = "test-n8n-jwt-secret-for-convex-test-only-32chars";
const TEST_WEBHOOK_URL = "https://n8n.local.test/webhook/lendloop-loan-notification";
const TEST_SERVICE_TOKEN = "test-n8n-service-token-current-32chars";
const TEST_SERVICE_TOKEN_PREVIOUS = "test-n8n-service-token-previous-32chars";

async function seedUsersAndListing(t: ReturnType<typeof createTestBackend>) {
  const lender = await t
    .withIdentity({ subject: "clerk_lender", email: "lender@example.com", name: "Lender Sam" })
    .mutation(api.users.mutations.syncCurrentUser, {});
  const borrower = await t
    .withIdentity({
      subject: "clerk_borrower",
      email: "borrower@example.com",
      name: "Borrower Pat",
    })
    .mutation(api.users.mutations.syncCurrentUser, {});

  const listing = await t
    .withIdentity({ subject: "clerk_lender", email: "lender@example.com", name: "Lender Sam" })
    .mutation(api.listings.mutations.createListing, {
      name: "Cordless Hammer Drill",
      category: "power_tools",
      condition: "good",
      description: "18V brushless drill with battery and charger.",
    });

  return { lenderId: lender._id, borrowerId: borrower._id, listingId: listing._id };
}

describe("Convex Automation Activity outbox & HS256 JWT delivery", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));
    process.env.N8N_WEBHOOK_URL = TEST_WEBHOOK_URL;
    process.env.N8N_JWT_SECRET = TEST_JWT_SECRET;
    process.env.APP_URL = "http://localhost:3000";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it("signs exact rawBody with 60s HS256 JWT (iss, aud, jti, bodySha256) and marks Automation Activity sent", async () => {
    const t = createTestBackend();
    const { listingId } = await seedUsersAndListing(t);

    const capturedRequests: Array<{
      url: string;
      authHeader: string | null;
      idempotencyKey: string | null;
      rawBody: string;
    }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const headers = new Headers(init?.headers);
      capturedRequests.push({
        url: String(input),
        authHeader: headers.get("Authorization"),
        idempotencyKey: headers.get("X-Idempotency-Key"),
        rawBody: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ status: "smtp_accepted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { _id: loanId } = await t
      .withIdentity({
        subject: "clerk_borrower",
        email: "borrower@example.com",
        name: "Borrower Pat",
      })
      .mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: "2026-06-16",
        endDate: "2026-06-18",
        note: "Need it for deck repair",
      });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0]!;
    expect(req.url).toBe(TEST_WEBHOOK_URL);
    expect(req.idempotencyKey).toBe(`loan_requested:${loanId}`);
    expect(req.authHeader?.startsWith("Bearer ")).toBe(true);

    const token = req.authHeader!.slice("Bearer ".length);
    const verified = await verifyAutomationJwt({
      token,
      secret: TEST_JWT_SECRET,
      rawBody: req.rawBody,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.iss).toBe("convex");
      expect(verified.payload.aud).toBe("n8n-automation");
      expect(verified.payload.jti).toBe(`loan_requested:${loanId}`);
      expect(verified.payload.exp - verified.payload.iat).toBe(60);
    }

    const parsedBody = JSON.parse(req.rawBody) as Record<string, unknown>;
    expect(parsedBody.eventType).toBe("loan_requested");
    expect(parsedBody.recipientRole).toBe("lender");
    expect(parsedBody.recipientEmail).toBe("lender@example.com");
    expect(parsedBody.listingName).toBe("Cordless Hammer Drill");

    const activities = await t.run(async (ctx) =>
      ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", loanId))
        .collect(),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]?.status).toBe("sent");
    expect(activities[0]?.attemptCount).toBe(1);
    expect(activities[0]?.completedAt).toBeDefined();
  });

  it("skips deleted-user recipients safely without calling fetch", async () => {
    const t = createTestBackend();
    const { lenderId, borrowerId, listingId } = await seedUsersAndListing(t);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { activityId } = await t.run(async (ctx) => {
      await ctx.db.patch(lenderId, {
        deletedAt: Date.now(),
        email: "",
        displayName: "Deleted User",
      });
      const loanId = await ctx.db.insert("loans", {
        listingId,
        lenderId,
        borrowerId,
        startDate: "2026-06-16",
        endDate: "2026-06-18",
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const id = await ctx.db.insert("automationActivities", {
        loanId,
        eventType: "loan_requested",
        idempotencyKey: `loan_requested:${loanId}`,
        status: "pending",
        attemptCount: 0,
        recipientRole: "lender",
        createdAt: Date.now(),
      });
      return { activityId: id };
    });

    const result = await t.action(internal.automation.actions.deliverLoanNotification, {
      activityId,
    });
    expect(result.outcome).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();

    const activity = await t.run(async (ctx) => ctx.db.get(activityId));
    expect(activity?.status).toBe("failed");
    expect(activity?.attemptCount).toBe(0);
    expect(activity?.lastError).toContain("deleted");
  });

  it("retries transient 429/5xx/network errors up to 3 attempts and succeeds on attempt 3", async () => {
    const t = createTestBackend();
    const { listingId } = await seedUsersAndListing(t);

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("Rate limited", { status: 429 });
      }
      if (callCount === 2) {
        throw new Error("ECONNRESET");
      }
      return new Response(JSON.stringify({ status: "smtp_accepted" }), { status: 200 });
    });

    const { _id: loanId } = await t
      .withIdentity({
        subject: "clerk_borrower",
        email: "borrower@example.com",
        name: "Borrower Pat",
      })
      .mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: "2026-06-16",
        endDate: "2026-06-18",
      });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(callCount).toBe(3);
    const activities = await t.run(async (ctx) =>
      ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", loanId))
        .collect(),
    );
    expect(activities[0]?.status).toBe("sent");
    expect(activities[0]?.attemptCount).toBe(3);
  });

  it("marks failed after 3 transient 503 attempts and fails immediately on 400/401/403", async () => {
    const t = createTestBackend();
    const { listingId } = await seedUsersAndListing(t);

    let callsFor503 = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callsFor503 += 1;
      return new Response("Upstream unavailable", { status: 503 });
    });

    const { _id: loan503 } = await t
      .withIdentity({
        subject: "clerk_borrower",
        email: "borrower@example.com",
        name: "Borrower Pat",
      })
      .mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: "2026-06-16",
        endDate: "2026-06-17",
      });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(callsFor503).toBe(3);

    const failed503 = await t.run(async (ctx) =>
      ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", loan503))
        .collect(),
    );
    expect(failed503[0]?.status).toBe("failed");
    expect(failed503[0]?.attemptCount).toBe(3);

    let callsFor401 = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callsFor401 += 1;
      return new Response("Unauthorized", { status: 401 });
    });

    const { _id: loan401 } = await t
      .withIdentity({
        subject: "clerk_borrower",
        email: "borrower@example.com",
        name: "Borrower Pat",
      })
      .mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: "2026-06-19",
        endDate: "2026-06-20",
      });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(callsFor401).toBe(1);

    const failed401 = await t.run(async (ctx) =>
      ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", loan401))
        .collect(),
    );
    expect(failed401[0]?.status).toBe("failed");
    expect(failed401[0]?.attemptCount).toBe(1);
    expect(failed401[0]?.lastError).toContain("401");
  });
});

describe("Authenticated n8n HTTP endpoints (token rotation, cursor pagination, idempotent ack)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T09:00:00.000Z"));
    process.env.N8N_SERVICE_TOKEN = TEST_SERVICE_TOKEN;
    process.env.N8N_SERVICE_TOKEN_PREVIOUS = TEST_SERVICE_TOKEN_PREVIOUS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it("enforces constant-time X-N8N-Service-Token validation and supports PREVIOUS token rotation", async () => {
    const t = createTestBackend();

    const missingRes = await t.fetch("/api/n8n/overdue-loans", { method: "GET" });
    expect(missingRes.status).toBe(401);

    const invalidRes = await t.fetch("/api/n8n/overdue-loans", {
      method: "GET",
      headers: { "X-N8N-Service-Token": "wrong-token" },
    });
    expect(invalidRes.status).toBe(401);

    const currentRes = await t.fetch("/api/n8n/overdue-loans", {
      method: "GET",
      headers: { "X-N8N-Service-Token": TEST_SERVICE_TOKEN },
    });
    expect(currentRes.status).toBe(200);

    const previousRes = await t.fetch("/api/n8n/overdue-loans", {
      method: "GET",
      headers: { "X-N8N-Service-Token": TEST_SERVICE_TOKEN_PREVIOUS },
    });
    expect(previousRes.status).toBe(200);

    const ackUnauth = await t.fetch("/api/n8n/overdue-reminders/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": "k1" },
      body: JSON.stringify({ loanId: "invalid", status: "sent" }),
    });
    expect(ackUnauth.status).toBe(401);
  });

  it("cursor-paginates overdue loans, skips deleted borrowers and already-sent today reminders, and handles idempotent ack", async () => {
    const t = createTestBackend();
    const { lenderId, borrowerId, listingId } = await seedUsersAndListing(t);

    const { overdueIds, sentAlreadyId } = await t.run(async (ctx) => {
      const deletedBorrowerId = await ctx.db.insert("users", {
        externalId: "deleted:user",
        email: "",
        displayName: "Deleted User",
        role: "user",
        trustedLender: false,
        deletedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const makeLoan = async (
        endDate: string,
        status: "approved" | "returned" | "pending",
        bId: Id<"users"> = borrowerId,
      ) =>
        ctx.db.insert("loans", {
          listingId,
          lenderId,
          borrowerId: bId,
          startDate: "2026-06-01",
          endDate,
          status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

      const loan1 = await makeLoan("2026-06-10", "approved");
      const loan2 = await makeLoan("2026-06-11", "approved");
      const loan3 = await makeLoan("2026-06-12", "approved");
      const sentToday = await makeLoan("2026-06-13", "approved");
      await makeLoan("2026-06-14", "approved", deletedBorrowerId);
      await makeLoan("2026-06-15", "approved"); // due today, not overdue
      await makeLoan("2026-06-05", "returned"); // returned, not overdue
      await makeLoan("2026-06-05", "pending"); // pending, not overdue

      await ctx.db.insert("automationActivities", {
        loanId: sentToday,
        eventType: "overdue_reminder",
        idempotencyKey: `overdue_reminder:${sentToday}:2026-06-15`,
        status: "sent",
        attemptCount: 1,
        recipientRole: "borrower",
        createdAt: Date.now(),
        completedAt: Date.now(),
      });

      return { overdueIds: [loan1, loan2, loan3], sentAlreadyId: sentToday };
    });

    const collected: Array<{ loanId: string; idempotencyKey: string; daysOverdue: number }> = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query = cursor
        ? `/api/n8n/overdue-loans?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "/api/n8n/overdue-loans?limit=2";
      const res = await t.fetch(query, {
        method: "GET",
        headers: { "X-N8N-Service-Token": TEST_SERVICE_TOKEN },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        items: Array<{ loanId: string; idempotencyKey: string; daysOverdue: number }>;
        nextCursor: string | null;
        isDone: boolean;
        todayUtc: string;
      };
      expect(data.todayUtc).toBe("2026-06-15");
      collected.push(...data.items);
      cursor = data.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBeGreaterThanOrEqual(2);
    expect(collected.map((item) => item.loanId)).toEqual(overdueIds);
    expect(collected.map((item) => item.loanId)).not.toContain(sentAlreadyId);
    expect(collected[0]?.daysOverdue).toBe(5);

    // Missing X-Idempotency-Key -> 400
    const missingKeyRes = await t.fetch("/api/n8n/overdue-reminders/ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-Service-Token": TEST_SERVICE_TOKEN,
      },
      body: JSON.stringify({ loanId: overdueIds[0], status: "sent" }),
    });
    expect(missingKeyRes.status).toBe(400);

    // First ack -> sent, duplicate: false
    const key1 = `overdue_reminder:${overdueIds[0]}:2026-06-15`;
    const ack1 = await t.fetch("/api/n8n/overdue-reminders/ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-Service-Token": TEST_SERVICE_TOKEN,
        "X-Idempotency-Key": key1,
      },
      body: JSON.stringify({ loanId: overdueIds[0], status: "sent", attemptCount: 1 }),
    });
    expect(ack1.status).toBe(200);
    const ack1Body = (await ack1.json()) as { duplicate: boolean; status: string };
    expect(ack1Body.duplicate).toBe(false);
    expect(ack1Body.status).toBe("sent");

    // Duplicate ack (even with failed) -> duplicate: true, stays sent
    const ack1Dup = await t.fetch("/api/n8n/overdue-reminders/ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-Service-Token": TEST_SERVICE_TOKEN_PREVIOUS,
        "X-Idempotency-Key": key1,
      },
      body: JSON.stringify({
        loanId: overdueIds[0],
        status: "failed",
        error: "SMTP failure for borrower@example.com",
      }),
    });
    expect(ack1Dup.status).toBe(200);
    const ack1DupBody = (await ack1Dup.json()) as { duplicate: boolean; status: string };
    expect(ack1DupBody.duplicate).toBe(true);
    expect(ack1DupBody.status).toBe("sent");

    // Failed ack redacts PII from error
    const key2 = `overdue_reminder:${overdueIds[1]}:2026-06-15`;
    const ack2 = await t.fetch("/api/n8n/overdue-reminders/ack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-Service-Token": TEST_SERVICE_TOKEN,
        "X-Idempotency-Key": key2,
      },
      body: JSON.stringify({
        loanId: overdueIds[1],
        status: "failed",
        attemptCount: 3,
        error: "SMTP timeout sending to borrower@example.com with Bearer secretToken123",
      }),
    });
    expect(ack2.status).toBe(200);

    const savedFailed = await t.run(async (ctx) =>
      ctx.db
        .query("automationActivities")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", key2))
        .unique(),
    );
    expect(savedFailed?.status).toBe("failed");
    expect(savedFailed?.lastError).not.toContain("borrower@example.com");
    expect(savedFailed?.lastError).not.toContain("secretToken123");
    expect(savedFailed?.lastError).toContain("[REDACTED]");

    // Now overdueIds[0] should be pre-filtered out of GET /api/n8n/overdue-loans
    const afterAckRes = await t.fetch("/api/n8n/overdue-loans?limit=100", {
      method: "GET",
      headers: { "X-N8N-Service-Token": TEST_SERVICE_TOKEN },
    });
    const afterAckData = (await afterAckRes.json()) as { items: Array<{ loanId: string }> };
    expect(afterAckData.items.map((i) => i.loanId)).not.toContain(overdueIds[0]);
    expect(afterAckData.items.map((i) => i.loanId)).toContain(overdueIds[1]);
  });
});
