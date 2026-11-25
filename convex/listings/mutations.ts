import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { DOMAIN_LIMITS } from "../../src/domain/types";
import { recordAuditLog } from "../audit/seam";
import { enqueueAutomationActivity } from "../automation/seam";
import { requireAdmin, requireCurrentUser, requireListingLender } from "../lib/authz";
import { createAppError } from "../lib/errors";
import { enforceRateLimit } from "../lib/rateLimit";
import { listingCategoryValidator, listingConditionValidator } from "../schema";
import {
  ALLOWED_STORED_CONTENT_TYPE,
  MAX_PENDING_UPLOADS_PER_USER,
  MAX_SANITIZED_IMAGE_DIMENSION,
  MAX_UPLOAD_BYTES,
  deleteListingImageBlobs,
  syncListingImages,
} from "./images";

const ARCHIVE_LOAN_BATCH_SIZE = 100;

async function autoDeclinePendingLoansForListing(
  ctx: MutationCtx,
  params: {
    listingId: Id<"listings">;
    decisionReason: string;
    reasonCode: "listing_archived_by_lender" | "listing_removed_by_admin";
    now: number;
    emitAuditAndNotification: boolean;
  },
): Promise<number> {
  let autoDeclinedCount = 0;

  for (;;) {
    const pendingBatch = await ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) =>
        q.eq("listingId", params.listingId).eq("status", "pending"),
      )
      .take(ARCHIVE_LOAN_BATCH_SIZE);

    if (pendingBatch.length === 0) {
      break;
    }

    for (const loan of pendingBatch) {
      await ctx.db.patch(loan._id, {
        status: "declined",
        decisionReason: params.decisionReason,
        updatedAt: params.now,
      });

      if (params.emitAuditAndNotification) {
        await recordAuditLog(ctx, {
          actorRole: "system",
          action: "loan.declined",
          targetType: "loan",
          targetId: loan._id,
          metadata: {
            listingId: params.listingId,
            autoDeclined: true,
            reasonCode: params.reasonCode,
          },
        });

        await enqueueAutomationActivity(ctx, {
          loanId: loan._id,
          eventType: "loan_declined",
          idempotencyKey: `loan_declined:${loan._id}`,
          recipientRole: "borrower",
        });
      }

      autoDeclinedCount += 1;
    }

    if (pendingBatch.length < ARCHIVE_LOAN_BATCH_SIZE) {
      break;
    }
  }

  return autoDeclinedCount;
}

function validateListingTextFields(name: string, description: string) {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();

  if (trimmedName.length === 0) {
    throw createAppError("VALIDATION_ERROR", "Listing name is required.");
  }
  if (trimmedName.length > DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH) {
    throw createAppError(
      "VALIDATION_ERROR",
      `Listing name cannot exceed ${DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH} characters.`,
    );
  }
  if (trimmedDescription.length === 0) {
    throw createAppError("VALIDATION_ERROR", "Listing description is required.");
  }
  if (trimmedDescription.length > DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH) {
    throw createAppError(
      "VALIDATION_ERROR",
      `Listing description cannot exceed ${DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH} characters.`,
    );
  }

  return { trimmedName, trimmedDescription };
}

async function assertPendingUploadCapacity(
  ctx: MutationCtx,
  uploaderId: Id<"users">,
  storageIdToDeleteOnExceed?: Id<"_storage">,
): Promise<void> {
  const pendingUploads = await ctx.db
    .query("listingImageUploads")
    .withIndex("by_uploader_status", (q) => q.eq("uploaderId", uploaderId).eq("status", "pending"))
    .take(MAX_PENDING_UPLOADS_PER_USER + 1);

  if (pendingUploads.length >= MAX_PENDING_UPLOADS_PER_USER) {
    if (storageIdToDeleteOnExceed) {
      await ctx.storage.delete(storageIdToDeleteOnExceed);
    }
    throw createAppError(
      "VALIDATION_ERROR",
      `You can have at most ${MAX_PENDING_UPLOADS_PER_USER} pending photo uploads at a time. Save or remove pending photos first.`,
    );
  }
}

/**
 * Generates a short-lived Convex storage upload URL for the authenticated User.
 * Enforces 10 uploads/minute rate limiting and the 10-pending-upload cap per User.
 */
export const generateListingImageUploadUrl = mutation({
  args: {},
  returns: v.object({
    uploadUrl: v.string(),
  }),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    await enforceRateLimit(ctx, "listingImageUpload", user._id);
    await assertPendingUploadCapacity(ctx, user._id);

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

/**
 * Registers a sanitized WebP upload in `listingImageUploads` owned by the authenticated User.
 * Verifies authoritative `_storage` system metadata (contentType and size) to prevent spoofing.
 */
export const registerListingImageUpload = mutation({
  args: {
    storageId: v.id("_storage"),
    contentType: v.string(),
    sizeBytes: v.number(),
    width: v.number(),
    height: v.number(),
  },
  returns: v.object({
    storageId: v.id("_storage"),
    url: v.string(),
    width: v.number(),
    height: v.number(),
    sizeBytes: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    if (args.contentType !== ALLOWED_STORED_CONTENT_TYPE) {
      throw createAppError("VALIDATION_ERROR", "Only sanitized WebP images can be registered.");
    }
    if (
      args.width <= 0 ||
      args.width > MAX_SANITIZED_IMAGE_DIMENSION ||
      args.height <= 0 ||
      args.height > MAX_SANITIZED_IMAGE_DIMENSION
    ) {
      throw createAppError(
        "VALIDATION_ERROR",
        `Sanitized photo dimensions must be within ${MAX_SANITIZED_IMAGE_DIMENSION}x${MAX_SANITIZED_IMAGE_DIMENSION}.`,
      );
    }

    const storageMeta = await ctx.db.system.get(args.storageId);
    if (!storageMeta) {
      throw createAppError("NOT_FOUND", "Uploaded photo blob was not found in storage.");
    }
    if (storageMeta.contentType !== ALLOWED_STORED_CONTENT_TYPE) {
      await ctx.storage.delete(args.storageId);
      throw createAppError(
        "VALIDATION_ERROR",
        "Stored photo must be a sanitized WebP image uploaded via the image endpoint.",
      );
    }
    if (storageMeta.size <= 0 || storageMeta.size > MAX_UPLOAD_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw createAppError("VALIDATION_ERROR", "Uploaded photo exceeds the 5 MB size limit.");
    }

    const existing = await ctx.db
      .query("listingImageUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .unique();

    if (existing) {
      throw createAppError("CONFLICT", "This uploaded photo has already been registered.");
    }

    await assertPendingUploadCapacity(ctx, user._id, args.storageId);

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) {
      throw createAppError("NOT_FOUND", "Uploaded photo blob was not found in storage.");
    }

    await ctx.db.insert("listingImageUploads", {
      storageId: args.storageId,
      uploaderId: user._id,
      status: "pending",
      contentType: storageMeta.contentType,
      sizeBytes: storageMeta.size,
      width: args.width,
      height: args.height,
      createdAt: Date.now(),
    });

    return {
      storageId: args.storageId,
      url,
      width: args.width,
      height: args.height,
      sizeBytes: storageMeta.size,
    };
  },
});

/**
 * Immediately discards a cancelled or unsaved pending photo upload owned by the caller.
 */
export const discardPendingListingImageUpload = mutation({
  args: {
    storageId: v.id("_storage"),
  },
  returns: v.object({
    discarded: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const upload = await ctx.db
      .query("listingImageUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .unique();

    if (!upload) {
      return { discarded: false };
    }

    if (upload.uploaderId !== user._id) {
      throw createAppError("FORBIDDEN", "You can only discard your own pending photo uploads.", {
        actorId: user._id,
        targetType: "listing",
        targetId: args.storageId,
      });
    }

    if (upload.status !== "pending") {
      throw createAppError("CONFLICT", "Cannot discard a photo that is already attached.");
    }

    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);

    return { discarded: true };
  },
});

/**
 * Creates a new Listing owned by the authenticated User, attaching 0–5 verified photos
 * and atomically recording a `listing.created` Audit Log entry.
 */
export const createListing = mutation({
  args: {
    name: v.string(),
    category: listingCategoryValidator,
    condition: listingConditionValidator,
    description: v.string(),
    imageIds: v.optional(v.array(v.id("_storage"))),
  },
  returns: v.object({
    _id: v.id("listings"),
  }),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await enforceRateLimit(ctx, "listingWrite", user._id);

    const { trimmedName, trimmedDescription } = validateListingTextFields(
      args.name,
      args.description,
    );
    const imageIds = args.imageIds ?? [];
    const now = Date.now();

    const listingId = await ctx.db.insert("listings", {
      lenderId: user._id,
      name: trimmedName,
      category: args.category,
      condition: args.condition,
      description: trimmedDescription,
      imageIds,
      createdAt: now,
      updatedAt: now,
    });

    await syncListingImages(ctx, {
      uploaderId: user._id,
      listingId,
      nextImageIds: imageIds,
    });

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "listing.created",
      targetType: "listing",
      targetId: listingId,
      metadata: {
        category: args.category,
        condition: args.condition,
        imageCount: imageIds.length,
      },
    });

    return { _id: listingId };
  },
});

/**
 * Updates an active Listing owned by the authenticated Lender.
 * Atomically claims newly uploaded photos and permanently deletes removed photos from `_storage`.
 */
export const updateListing = mutation({
  args: {
    listingId: v.id("listings"),
    name: v.string(),
    category: listingCategoryValidator,
    condition: listingConditionValidator,
    description: v.string(),
    imageIds: v.array(v.id("_storage")),
  },
  returns: v.object({
    _id: v.id("listings"),
    removedImageCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, listing } = await requireListingLender(ctx, args.listingId);

    if (listing.archivedAt !== undefined) {
      throw createAppError("CONFLICT", "Archived Listings cannot be edited.");
    }

    await enforceRateLimit(ctx, "listingWrite", user._id);

    const { trimmedName, trimmedDescription } = validateListingTextFields(
      args.name,
      args.description,
    );

    const { removedCount } = await syncListingImages(ctx, {
      uploaderId: user._id,
      listingId: listing._id,
      nextImageIds: args.imageIds,
      existingImageIds: listing.imageIds ?? [],
    });

    await ctx.db.patch(listing._id, {
      name: trimmedName,
      category: args.category,
      condition: args.condition,
      description: trimmedDescription,
      imageIds: args.imageIds,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "listing.updated",
      targetType: "listing",
      targetId: listing._id,
      metadata: {
        category: args.category,
        condition: args.condition,
        imageCount: args.imageIds.length,
        removedImageCount: removedCount,
      },
    });

    return { _id: listing._id, removedImageCount: removedCount };
  },
});

/**
 * Archives (soft-deletes) a Listing owned by the authenticated Lender.
 * - Blocked with CONFLICT if any unreturned `approved` Loan exists.
 * - Atomically auto-declines all open `pending` Loans.
 * - Deletes all Listing image blobs from `_storage`.
 * - Records a `listing.archived` Audit Log entry.
 */
export const archiveListing = mutation({
  args: {
    listingId: v.id("listings"),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    _id: v.id("listings"),
    autoDeclinedCount: v.number(),
    deletedImageCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, listing } = await requireListingLender(ctx, args.listingId);

    if (listing.archivedAt !== undefined) {
      throw createAppError("CONFLICT", "This Listing is already archived.");
    }

    await enforceRateLimit(ctx, "listingWrite", user._id);

    const trimmedReason = (args.reason ?? "").trim();
    if (trimmedReason.length > DOMAIN_LIMITS.MAX_REASON_LENGTH) {
      throw createAppError(
        "VALIDATION_ERROR",
        `Archive reason cannot exceed ${DOMAIN_LIMITS.MAX_REASON_LENGTH} characters.`,
      );
    }

    const activeApprovedLoan = await ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) =>
        q.eq("listingId", listing._id).eq("status", "approved"),
      )
      .first();

    if (activeApprovedLoan) {
      throw createAppError(
        "CONFLICT",
        "Cannot delete this Listing while an approved Loan has not been returned. Mark the Loan as returned first.",
      );
    }

    const now = Date.now();
    const autoDeclinedCount = await autoDeclinePendingLoansForListing(ctx, {
      listingId: listing._id,
      decisionReason: "Listing archived",
      reasonCode: "listing_archived_by_lender",
      now,
      emitAuditAndNotification: false,
    });

    const deletedImageCount = await deleteListingImageBlobs(ctx, listing.imageIds ?? []);

    await ctx.db.patch(listing._id, {
      archivedAt: now,
      archivedBy: user._id,
      archiveReason: trimmedReason || "Archived by Lender",
      imageIds: [],
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "listing.archived",
      targetType: "listing",
      targetId: listing._id,
      metadata: {
        autoDeclinedCount,
        deletedImageCount,
        actorType: "lender",
      },
    });

    return {
      _id: listing._id,
      autoDeclinedCount,
      deletedImageCount,
    };
  },
});

/**
 * Admin-only forced Listing removal (`/admin` → Listings tab).
 * - Requires a non-empty `archiveReason` (<= 300 chars).
 * - Allowed EVEN when unreturned `approved` Loans exist (active Loans remain returnable
 *   and are flagged as `"Listing removed"` via `listing.isArchived`).
 * - Atomically auto-declines open `pending` Loans (recording Audit Log + `loan_declined` Automation Activity).
 * - Immediately deletes all Listing image blobs from `_storage`.
 * - Writes an atomic `listing.archived` Audit Log entry with zero PII.
 */
export const adminRemoveListing = mutation({
  args: {
    listingId: v.id("listings"),
    archiveReason: v.string(),
  },
  returns: v.object({
    _id: v.id("listings"),
    autoDeclinedCount: v.number(),
    deletedImageCount: v.number(),
    activeApprovedLoanCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await enforceRateLimit(ctx, "adminWrite", admin._id);

    const trimmedReason = args.archiveReason.trim();
    if (trimmedReason.length === 0) {
      throw createAppError(
        "VALIDATION_ERROR",
        "An archive reason is required to remove a Listing.",
      );
    }
    if (trimmedReason.length > DOMAIN_LIMITS.MAX_REASON_LENGTH) {
      throw createAppError(
        "VALIDATION_ERROR",
        `Archive reason cannot exceed ${DOMAIN_LIMITS.MAX_REASON_LENGTH} characters.`,
      );
    }

    const listing = await ctx.db.get(args.listingId);
    if (!listing) {
      throw createAppError("NOT_FOUND", "Listing not found.");
    }
    if (listing.archivedAt !== undefined) {
      throw createAppError("CONFLICT", "This Listing is already archived.");
    }

    const activeApprovedLoans = await ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) =>
        q.eq("listingId", listing._id).eq("status", "approved"),
      )
      .take(ARCHIVE_LOAN_BATCH_SIZE);
    const activeApprovedLoanCount = activeApprovedLoans.length;

    const now = Date.now();
    const autoDeclinedCount = await autoDeclinePendingLoansForListing(ctx, {
      listingId: listing._id,
      decisionReason: "Listing removed by Admin",
      reasonCode: "listing_removed_by_admin",
      now,
      emitAuditAndNotification: true,
    });

    const deletedImageCount = await deleteListingImageBlobs(ctx, listing.imageIds ?? []);

    await ctx.db.patch(listing._id, {
      archivedAt: now,
      archivedBy: admin._id,
      archiveReason: trimmedReason,
      imageIds: [],
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorId: admin._id,
      actorRole: admin.role,
      action: "listing.archived",
      targetType: "listing",
      targetId: listing._id,
      metadata: {
        actorType: "admin",
        autoDeclinedCount,
        deletedImageCount,
        activeApprovedLoanCount,
      },
    });

    return {
      _id: listing._id,
      autoDeclinedCount,
      deletedImageCount,
      activeApprovedLoanCount,
    };
  },
});
