import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DOMAIN_LIMITS } from "../../src/domain/types";
import { createAppError } from "../lib/errors";

export const MAX_PENDING_UPLOADS_PER_USER = 10;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SANITIZED_IMAGE_DIMENSION = 1600;
export const ALLOWED_STORED_CONTENT_TYPE = "image/webp";

type StorageCtx = QueryCtx | MutationCtx;

/**
 * Narrow listing-images storage adapter over Convex `_storage`.
 * Returns resolved URLs only for public and catalog DTOs.
 */
export async function resolveListingImageUrls(
  ctx: StorageCtx,
  imageIds?: ReadonlyArray<Id<"_storage">>,
): Promise<Array<{ url: string }>> {
  if (!imageIds || imageIds.length === 0) {
    return [];
  }

  const bounded = imageIds.slice(0, DOMAIN_LIMITS.MAX_LISTING_IMAGES);
  const resolved: Array<{ url: string }> = [];

  for (const storageId of bounded) {
    const url = await ctx.storage.getUrl(storageId);
    if (url) {
      resolved.push({ url });
    }
  }

  return resolved;
}

/**
 * Resolves image URLs alongside their `storageId`s strictly for the Lender's edit view.
 */
export async function resolveEditableListingImages(
  ctx: StorageCtx,
  imageIds?: ReadonlyArray<Id<"_storage">>,
): Promise<Array<{ storageId: Id<"_storage">; url: string }>> {
  if (!imageIds || imageIds.length === 0) {
    return [];
  }

  const bounded = imageIds.slice(0, DOMAIN_LIMITS.MAX_LISTING_IMAGES);
  const resolved: Array<{ storageId: Id<"_storage">; url: string }> = [];

  for (const storageId of bounded) {
    const url = await ctx.storage.getUrl(storageId);
    if (url) {
      resolved.push({ storageId, url });
    }
  }

  return resolved;
}

/**
 * Atomically deletes the given image blobs from `_storage` and removes their
 * corresponding `listingImageUploads` tracking records.
 */
export async function deleteListingImageBlobs(
  ctx: MutationCtx,
  storageIds: ReadonlyArray<Id<"_storage">>,
): Promise<number> {
  let deletedCount = 0;
  for (const storageId of storageIds) {
    const uploadRecord = await ctx.db
      .query("listingImageUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
      .unique();

    await ctx.storage.delete(storageId);
    if (uploadRecord) {
      await ctx.db.delete(uploadRecord._id);
    }
    deletedCount += 1;
  }
  return deletedCount;
}

/**
 * Validates that the image list respects the 0–5 cap and contains no duplicates,
 * enforces anti-IDOR ownership on every newly attached `storageId`, marks newly
 * attached uploads as `attached`, and atomically deletes removed blobs on edit.
 */
export async function syncListingImages(
  ctx: MutationCtx,
  params: {
    uploaderId: Id<"users">;
    listingId: Id<"listings">;
    nextImageIds: ReadonlyArray<Id<"_storage">>;
    existingImageIds?: ReadonlyArray<Id<"_storage">>;
  },
): Promise<{ removedCount: number }> {
  const { uploaderId, listingId, nextImageIds, existingImageIds = [] } = params;

  if (nextImageIds.length > DOMAIN_LIMITS.MAX_LISTING_IMAGES) {
    throw createAppError(
      "VALIDATION_ERROR",
      `A Listing can have at most ${DOMAIN_LIMITS.MAX_LISTING_IMAGES} photos.`,
    );
  }

  const uniqueNext = new Set(nextImageIds);
  if (uniqueNext.size !== nextImageIds.length) {
    throw createAppError("VALIDATION_ERROR", "Duplicate photo references are not allowed.");
  }

  const existingSet = new Set(existingImageIds);
  const toClaimIds: Id<"listingImageUploads">[] = [];

  for (const storageId of nextImageIds) {
    if (existingSet.has(storageId)) {
      continue;
    }

    const upload = await ctx.db
      .query("listingImageUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
      .unique();

    if (!upload || upload.uploaderId !== uploaderId || upload.status !== "pending") {
      throw createAppError(
        "FORBIDDEN",
        "One or more photos do not belong to you or are no longer available to attach.",
        {
          actorId: uploaderId,
          targetType: "listing",
          targetId: listingId,
        },
      );
    }

    toClaimIds.push(upload._id);
  }

  for (const uploadId of toClaimIds) {
    await ctx.db.patch(uploadId, {
      status: "attached",
      listingId,
    });
  }

  const removedStorageIds = existingImageIds.filter((id) => !uniqueNext.has(id));
  const removedCount = await deleteListingImageBlobs(ctx, removedStorageIds);

  return { removedCount };
}
