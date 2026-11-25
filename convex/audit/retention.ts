import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

export const AUDIT_LOG_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const RETENTION_BATCH_SIZE = 100;

/**
 * Daily bounded cleanup of Audit Log entries older than 365 days in `.take(100)`
 * self-rescheduling batches.
 */
export const pruneExpiredAuditLogs = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
  },
  returns: v.object({
    deletedCount: v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const cutoff = nowMs - AUDIT_LOG_RETENTION_MS;

    const batch = await ctx.db
      .query("auditLogs")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(RETENTION_BATCH_SIZE);

    for (const entry of batch) {
      await ctx.db.delete(entry._id);
    }

    const rescheduled = batch.length === RETENTION_BATCH_SIZE;
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.audit.retention.pruneExpiredAuditLogs, {
        nowMs,
      });
    }

    return {
      deletedCount: batch.length,
      rescheduled,
    };
  },
});
