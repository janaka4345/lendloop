import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, mutation } from "../_generated/server";
import { recordAuditLog } from "../audit/seam";
import { requireAdmin, requireIdentity } from "../lib/authz";
import { createAppError } from "../lib/errors";
import { enforceRateLimit } from "../lib/rateLimit";
import { userRoleValidator } from "../schema";

export const currentUserDtoValidator = v.object({
  _id: v.id("users"),
  displayName: v.string(),
  email: v.string(),
  role: userRoleValidator,
  trustedLender: v.boolean(),
});

export function toCurrentUserDto(user: Doc<"users">) {
  return {
    _id: user._id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    trustedLender: user.trustedLender,
  };
}

function isBootstrapAdminEmail(email: string): boolean {
  if (!email) return false;
  if ((process.env.APP_ENV ?? "").trim().toLowerCase() === "prod") {
    return false;
  }
  const raw = process.env.BOOTSTRAP_ADMIN_EMAILS ?? "";
  if (!raw.trim()) return false;
  const allowlist = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return allowlist.includes(email.trim().toLowerCase());
}

const CASCADE_BATCH_SIZE = 100;

async function drainBatches<T>(
  fetchBatch: () => Promise<T[]>,
  processItem: (item: T) => Promise<void>,
): Promise<number> {
  let count = 0;
  for (;;) {
    const batch = await fetchBatch();
    if (batch.length === 0) break;
    for (const item of batch) {
      await processItem(item);
      count += 1;
    }
    if (batch.length < CASCADE_BATCH_SIZE) break;
  }
  return count;
}

export const syncCurrentUser = mutation({
  args: {},
  returns: currentUserDtoValidator,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const externalId = identity.subject;

    await enforceRateLimit(ctx, "syncCurrentUser", externalId);

    const email = (identity.email ?? "").trim().toLowerCase();
    const rawDisplayName = (identity.name ?? identity.nickname ?? identity.givenName ?? "").trim();
    const now = Date.now();

    const existing = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();

    if (existing) {
      if (existing.deletedAt !== undefined) {
        throw createAppError("FORBIDDEN", "This User has been deleted.", {
          targetType: "user",
          targetId: existing._id,
        });
      }

      const nextEmail = email || existing.email;
      const nextDisplayName = rawDisplayName || existing.displayName;
      if (nextEmail !== existing.email || nextDisplayName !== existing.displayName) {
        await ctx.db.patch(existing._id, {
          email: nextEmail,
          displayName: nextDisplayName,
          updatedAt: now,
        });
      }

      return toCurrentUserDto({
        ...existing,
        email: nextEmail,
        displayName: nextDisplayName,
      });
    }

    const displayName = rawDisplayName || "Neighbor";
    const initialRole: "user" | "admin" = isBootstrapAdminEmail(email) ? "admin" : "user";
    const userId = await ctx.db.insert("users", {
      externalId,
      email,
      displayName,
      role: initialRole,
      trustedLender: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      _id: userId,
      displayName,
      email,
      role: initialRole,
      trustedLender: false,
    };
  },
});

export const setUserRole = internalMutation({
  args: {
    userId: v.id("users"),
    role: userRoleValidator,
    reason: v.optional(v.string()),
  },
  returns: v.object({
    _id: v.id("users"),
    role: userRoleValidator,
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw createAppError("NOT_FOUND", "User not found.");
    }
    if (user.deletedAt !== undefined) {
      throw createAppError("FORBIDDEN", "Cannot change role of a deleted User.");
    }

    const previousRole = user.role;
    if (previousRole !== args.role) {
      await ctx.db.patch(args.userId, {
        role: args.role,
        updatedAt: Date.now(),
      });

      await recordAuditLog(ctx, {
        actorRole: "system",
        action: "user.role_changed",
        targetType: "user",
        targetId: args.userId,
        metadata: {
          previousRole,
          nextRole: args.role,
          ...(args.reason ? { reason: args.reason } : {}),
        },
      });
    }

    return { _id: args.userId, role: args.role };
  },
});

/**
 * Admin-only mutation to grant or revoke the display-only `Trusted Lender` badge.
 * Writes an atomic `user.trusted_lender_toggled` Audit Log entry with zero PII.
 */
export const setTrustedLender = mutation({
  args: {
    userId: v.id("users"),
    trustedLender: v.boolean(),
  },
  returns: v.object({
    _id: v.id("users"),
    trustedLender: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await enforceRateLimit(ctx, "adminWrite", admin._id);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw createAppError("NOT_FOUND", "User not found.");
    }
    if (user.deletedAt !== undefined) {
      throw createAppError("CONFLICT", "Cannot update Trusted Lender status for a deleted User.");
    }

    const previousTrustedLender = user.trustedLender;
    if (previousTrustedLender !== args.trustedLender) {
      await ctx.db.patch(args.userId, {
        trustedLender: args.trustedLender,
        updatedAt: Date.now(),
      });

      await recordAuditLog(ctx, {
        actorId: admin._id,
        actorRole: admin.role,
        action: "user.trusted_lender_toggled",
        targetType: "user",
        targetId: args.userId,
        metadata: {
          previousTrustedLender,
          nextTrustedLender: args.trustedLender,
        },
      });
    }

    return { _id: args.userId, trustedLender: args.trustedLender };
  },
});

export const handleClerkUserUpdated = internalMutation({
  args: {
    externalId: v.string(),
    email: v.string(),
    displayName: v.string(),
  },
  returns: v.object({ updated: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!user || user.deletedAt !== undefined) {
      return { updated: false };
    }

    const nextEmail = args.email.trim().toLowerCase() || user.email;
    const nextDisplayName = args.displayName.trim() || user.displayName;

    await ctx.db.patch(user._id, {
      email: nextEmail,
      displayName: nextDisplayName,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const handleClerkUserDeleted = internalMutation({
  args: {
    externalId: v.string(),
  },
  returns: v.object({
    deleted: v.boolean(),
    archivedListings: v.number(),
    deletedUploads: v.number(),
    cancelledLoans: v.number(),
    declinedLoans: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!user || user.deletedAt !== undefined) {
      return {
        deleted: false,
        archivedListings: 0,
        deletedUploads: 0,
        cancelledLoans: 0,
        declinedLoans: 0,
      };
    }

    const now = Date.now();

    // 1. Anonymize User tombstone (preserves referential & audit integrity)
    await ctx.db.patch(user._id, {
      externalId: `deleted:${user._id}`,
      email: "",
      displayName: "Deleted User",
      trustedLender: false,
      deletedAt: now,
      updatedAt: now,
    });

    // 2. Archive active Listings and delete their image blobs
    const archivedListings = await drainBatches(
      () =>
        ctx.db
          .query("listings")
          .withIndex("by_lender_archived", (q) =>
            q.eq("lenderId", user._id).eq("archivedAt", undefined),
          )
          .take(CASCADE_BATCH_SIZE),
      async (listing) => {
        if (listing.imageIds) {
          for (const storageId of listing.imageIds) {
            await ctx.storage.delete(storageId);
          }
        }
        await ctx.db.patch(listing._id, {
          archivedAt: now,
          archivedBy: user._id,
          archiveReason: "User deleted",
          imageIds: [],
          updatedAt: now,
        });
      },
    );

    // 3. Clean up pending image uploads and their storage blobs
    const deletedUploads = await drainBatches(
      () =>
        ctx.db
          .query("listingImageUploads")
          .withIndex("by_uploader_status", (q) =>
            q.eq("uploaderId", user._id).eq("status", "pending"),
          )
          .take(CASCADE_BATCH_SIZE),
      async (upload) => {
        await ctx.storage.delete(upload.storageId);
        await ctx.db.delete(upload._id);
      },
    );

    // 4. Auto-cancel pending Borrower Loans (preserving approved and historical Loans)
    const cancelledLoans = await drainBatches(
      () =>
        ctx.db
          .query("loans")
          .withIndex("by_borrower_status", (q) =>
            q.eq("borrowerId", user._id).eq("status", "pending"),
          )
          .take(CASCADE_BATCH_SIZE),
      async (loan) => {
        await ctx.db.patch(loan._id, {
          status: "cancelled",
          decisionReason: "Borrower User deleted",
          updatedAt: now,
        });
      },
    );

    // 5. Auto-decline pending Lender Loans (preserving approved and historical Loans)
    const declinedLoans = await drainBatches(
      () =>
        ctx.db
          .query("loans")
          .withIndex("by_lender_status", (q) => q.eq("lenderId", user._id).eq("status", "pending"))
          .take(CASCADE_BATCH_SIZE),
      async (loan) => {
        await ctx.db.patch(loan._id, {
          status: "declined",
          decisionReason: "Lender User deleted",
          updatedAt: now,
        });
      },
    );

    // 6. Record non-PII Audit Log entry atomically
    await recordAuditLog(ctx, {
      actorRole: "system",
      action: "user.deleted",
      targetType: "user",
      targetId: user._id,
      metadata: {
        archivedListings,
        deletedUploads,
        cancelledLoans,
        declinedLoans,
      },
    });

    return {
      deleted: true,
      archivedListings,
      deletedUploads,
      cancelledLoans,
      declinedLoans,
    };
  },
});
