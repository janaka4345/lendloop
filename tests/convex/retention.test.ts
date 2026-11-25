import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { AUDIT_LOG_RETENTION_MS } from "../../convex/audit/retention";
import { TERMINAL_ACTIVITY_RETENTION_MS } from "../../convex/automation/retention";
import { PENDING_UPLOAD_RETENTION_MS } from "../../convex/listings/retention";
import { createTestBackend } from "./test-helpers";

describe("Bounded Convex retention crons (.take(100) self-rescheduling)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T04:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes abandoned pending image uploads and _storage blobs older than 2 hours while preserving recent pending and attached uploads", async () => {
    const t = createTestBackend();
    const now = Date.now();

    const { expiredPendingStorageId, recentPendingStorageId, oldAttachedStorageId } = await t.run(
      async (ctx) => {
        const uploaderId = await ctx.db.insert("users", {
          externalId: "clerk_uploader",
          email: "uploader@example.com",
          displayName: "Uploader",
          role: "user",
          trustedLender: false,
          createdAt: now,
          updatedAt: now,
        });

        const s1 = await ctx.storage.store(new Blob(["old-pending"], { type: "image/webp" }));
        const s2 = await ctx.storage.store(new Blob(["recent-pending"], { type: "image/webp" }));
        const s3 = await ctx.storage.store(new Blob(["old-attached"], { type: "image/webp" }));

        await ctx.db.insert("listingImageUploads", {
          storageId: s1,
          uploaderId,
          status: "pending",
          contentType: "image/webp",
          sizeBytes: 100,
          width: 100,
          height: 100,
          createdAt: now - PENDING_UPLOAD_RETENTION_MS - 1_000,
        });
        await ctx.db.insert("listingImageUploads", {
          storageId: s2,
          uploaderId,
          status: "pending",
          contentType: "image/webp",
          sizeBytes: 100,
          width: 100,
          height: 100,
          createdAt: now - PENDING_UPLOAD_RETENTION_MS + 60_000,
        });
        await ctx.db.insert("listingImageUploads", {
          storageId: s3,
          uploaderId,
          status: "attached",
          contentType: "image/webp",
          sizeBytes: 100,
          width: 100,
          height: 100,
          createdAt: now - PENDING_UPLOAD_RETENTION_MS - 10_000_000,
        });

        return {
          expiredPendingStorageId: s1,
          recentPendingStorageId: s2,
          oldAttachedStorageId: s3,
        };
      },
    );

    const result = await t.mutation(internal.listings.retention.pruneAbandonedPendingUploads, {
      nowMs: now,
    });
    expect(result).toEqual({ deletedCount: 1, rescheduled: false });

    const state = await t.run(async (ctx) => {
      const remaining = await ctx.db.query("listingImageUploads").collect();
      const s1Exists = (await ctx.storage.get(expiredPendingStorageId)) !== null;
      const s2Exists = (await ctx.storage.get(recentPendingStorageId)) !== null;
      const s3Exists = (await ctx.storage.get(oldAttachedStorageId)) !== null;
      return {
        remainingStorageIds: remaining.map((u) => u.storageId),
        s1Exists,
        s2Exists,
        s3Exists,
      };
    });

    expect(state.s1Exists).toBe(false);
    expect(state.s2Exists).toBe(true);
    expect(state.s3Exists).toBe(true);
    expect(state.remainingStorageIds).toEqual(
      expect.arrayContaining([recentPendingStorageId, oldAttachedStorageId]),
    );
    expect(state.remainingStorageIds).not.toContain(expiredPendingStorageId);
  });

  it("prunes terminal (sent/failed) Automation Activity rows older than 90 days while never deleting pending rows", async () => {
    const t = createTestBackend();
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        externalId: "clerk_u",
        email: "u@example.com",
        displayName: "User",
        role: "user",
        trustedLender: false,
        createdAt: now,
        updatedAt: now,
      });
      const listingId = await ctx.db.insert("listings", {
        lenderId: userId,
        name: "Saw",
        category: "power_tools",
        condition: "good",
        description: "Circular saw",
        createdAt: now,
        updatedAt: now,
      });
      const loanId = await ctx.db.insert("loans", {
        listingId,
        lenderId: userId,
        borrowerId: userId,
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        status: "returned",
        createdAt: now,
        updatedAt: now,
      });

      const oldSent = await ctx.db.insert("automationActivities", {
        loanId,
        eventType: "loan_requested",
        idempotencyKey: "k_old_sent",
        status: "sent",
        attemptCount: 1,
        recipientRole: "lender",
        createdAt: now - TERMINAL_ACTIVITY_RETENTION_MS - 5_000,
        completedAt: now - TERMINAL_ACTIVITY_RETENTION_MS - 1_000,
      });
      const oldFailed = await ctx.db.insert("automationActivities", {
        loanId,
        eventType: "loan_approved",
        idempotencyKey: "k_old_failed",
        status: "failed",
        attemptCount: 3,
        recipientRole: "borrower",
        lastError: "HTTP 503",
        createdAt: now - TERMINAL_ACTIVITY_RETENTION_MS - 5_000,
        completedAt: now - TERMINAL_ACTIVITY_RETENTION_MS - 1_000,
      });
      const oldPending = await ctx.db.insert("automationActivities", {
        loanId,
        eventType: "loan_declined",
        idempotencyKey: "k_old_pending",
        status: "pending",
        attemptCount: 0,
        recipientRole: "borrower",
        createdAt: now - TERMINAL_ACTIVITY_RETENTION_MS - 10_000_000,
      });
      const recentSent = await ctx.db.insert("automationActivities", {
        loanId,
        eventType: "loan_returned",
        idempotencyKey: "k_recent_sent",
        status: "sent",
        attemptCount: 1,
        recipientRole: "borrower",
        createdAt: now - TERMINAL_ACTIVITY_RETENTION_MS + 60_000,
        completedAt: now - TERMINAL_ACTIVITY_RETENTION_MS + 60_000,
      });

      return { oldSent, oldFailed, oldPending, recentSent };
    });

    const result = await t.mutation(internal.automation.retention.pruneTerminalActivities, {
      nowMs: now,
    });
    expect(result).toEqual({ deletedCount: 2, rescheduled: false });

    const remainingIds = await t.run(async (ctx) =>
      (await ctx.db.query("automationActivities").collect()).map((r) => r._id),
    );
    expect(remainingIds).toEqual(expect.arrayContaining([ids.oldPending, ids.recentSent]));
    expect(remainingIds).not.toContain(ids.oldSent);
    expect(remainingIds).not.toContain(ids.oldFailed);
  });

  it("prunes Audit Log entries older than 365 days and self-reschedules when a batch hits 100 rows", async () => {
    const t = createTestBackend();
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i += 1) {
        await ctx.db.insert("auditLogs", {
          actorRole: "system",
          action: "loan.requested",
          targetType: "loan",
          targetId: `old_loan_${i}`,
          createdAt: now - AUDIT_LOG_RETENTION_MS - 10_000 - i,
        });
      }
      await ctx.db.insert("auditLogs", {
        actorRole: "system",
        action: "loan.approved",
        targetType: "loan",
        targetId: "recent_loan",
        createdAt: now - AUDIT_LOG_RETENTION_MS + 60_000,
      });
    });

    const firstPass = await t.mutation(internal.audit.retention.pruneExpiredAuditLogs, {
      nowMs: now,
    });
    expect(firstPass).toEqual({ deletedCount: 100, rescheduled: true });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await t.run(async (ctx) => ctx.db.query("auditLogs").collect());
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.targetId).toBe("recent_loan");
  });
});
