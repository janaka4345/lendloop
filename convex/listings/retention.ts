import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

export const PENDING_UPLOAD_RETENTION_MS = 2 * 60 * 60 * 1000;
export const RETENTION_BATCH_SIZE = 100;

/**
 * Hourly bounded cleanup of abandoned `pending` Listing image uploads older than 2 hours.
 * Deletes both the `_storage` blob and the `listingImageUploads` tracking row in `.take(100)`
 * self-rescheduling batches. Never touches `attached` uploads.
 */
export const pruneAbandonedPendingUploads = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
  },
  returns: v.object({
    deletedCount: v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const cutoff = nowMs - PENDING_UPLOAD_RETENTION_MS;

    const batch = await ctx.db
      .query("listingImageUploads")
      .withIndex("by_status_created", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
      .take(RETENTION_BATCH_SIZE);

    for (const upload of batch) {
      try {
        await ctx.storage.delete(upload.storageId);
      } catch {
        // Storage blob may already be removed; continue deleting the tracking row.
      }
      await ctx.db.delete(upload._id);
    }

    const rescheduled = batch.length === RETENTION_BATCH_SIZE;
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.listings.retention.pruneAbandonedPendingUploads, {
        nowMs,
      });
    }

    return {
      deletedCount: batch.length,
      rescheduled,
    };
  },
});
