import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

export const TERMINAL_ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const RETENTION_BATCH_SIZE = 100;

/**
 * Daily bounded cleanup of terminal (`sent` | `failed`) Automation Activity rows older than 90 days.
 * Strictly preserves all `pending` rows regardless of age and self-reschedules `.take(100)` batches.
 */
export const pruneTerminalActivities = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
  },
  returns: v.object({
    deletedCount: v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const cutoff = nowMs - TERMINAL_ACTIVITY_RETENTION_MS;

    const sentBatch = await ctx.db
      .query("automationActivities")
      .withIndex("by_status_completed", (q) =>
        q.eq("status", "sent").gte("completedAt", 0).lt("completedAt", cutoff),
      )
      .take(RETENTION_BATCH_SIZE);

    for (const row of sentBatch) {
      await ctx.db.delete(row._id);
    }

    let deletedCount = sentBatch.length;
    const remaining = RETENTION_BATCH_SIZE - deletedCount;

    if (remaining > 0) {
      const failedBatch = await ctx.db
        .query("automationActivities")
        .withIndex("by_status_completed", (q) =>
          q.eq("status", "failed").gte("completedAt", 0).lt("completedAt", cutoff),
        )
        .take(remaining);

      for (const row of failedBatch) {
        await ctx.db.delete(row._id);
      }
      deletedCount += failedBatch.length;
    }

    const rescheduled = deletedCount === RETENTION_BATCH_SIZE;
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.automation.retention.pruneTerminalActivities, {
        nowMs,
      });
    }

    return {
      deletedCount,
      rescheduled,
    };
  },
});
