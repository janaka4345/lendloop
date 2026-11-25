import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { ListingAvailability } from "../../src/domain/types";
import { listingCategoryValidator, listingConditionValidator } from "../schema";

export const listingAvailabilityValidator = v.union(
  v.literal("Available"),
  v.literal("Currently Borrowed"),
);

export const publicListingImageValidator = v.object({
  url: v.string(),
});

export const editableListingImageValidator = v.object({
  storageId: v.id("_storage"),
  url: v.string(),
});

/**
 * Strict allow-listed Public DTO for unauthenticated `/`.
 * Contains ONLY `_id`, `name`, `category`, and up to 5 resolved photo URLs.
 * Zero Lender identity, Trusted Lender badge, Condition, description, storageId, or Loan data.
 */
export const publicListingDtoValidator = v.object({
  _id: v.id("listings"),
  name: v.string(),
  category: listingCategoryValidator,
  images: v.array(publicListingImageValidator),
});

export const catalogListingDtoValidator = v.object({
  _id: v.id("listings"),
  name: v.string(),
  category: listingCategoryValidator,
  condition: listingConditionValidator,
  availability: listingAvailabilityValidator,
  images: v.array(publicListingImageValidator),
  lender: v.object({
    id: v.id("users"),
    displayName: v.string(),
    trustedLender: v.boolean(),
  }),
  createdAt: v.number(),
});

export const myListingDtoValidator = v.object({
  _id: v.id("listings"),
  name: v.string(),
  category: listingCategoryValidator,
  condition: listingConditionValidator,
  description: v.string(),
  availability: listingAvailabilityValidator,
  images: v.array(publicListingImageValidator),
  pendingRequestCount: v.number(),
  hasActiveApprovedLoan: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const editableListingDtoValidator = v.object({
  _id: v.id("listings"),
  name: v.string(),
  category: listingCategoryValidator,
  condition: listingConditionValidator,
  description: v.string(),
  images: v.array(editableListingImageValidator),
  pendingRequestCount: v.number(),
  hasActiveApprovedLoan: v.boolean(),
});

export function toPublicListingDto(listing: Doc<"listings">, images: Array<{ url: string }>) {
  return {
    _id: listing._id,
    name: listing.name,
    category: listing.category,
    images,
  };
}

export function toCatalogListingDto(
  listing: Doc<"listings">,
  params: {
    availability: ListingAvailability;
    images: Array<{ url: string }>;
    lender: Doc<"users"> | null;
  },
) {
  return {
    _id: listing._id,
    name: listing.name,
    category: listing.category,
    condition: listing.condition,
    availability: params.availability,
    images: params.images,
    lender: {
      id: listing.lenderId,
      displayName: params.lender?.displayName ?? "Deleted User",
      trustedLender: params.lender?.trustedLender ?? false,
    },
    createdAt: listing.createdAt,
  };
}

export function toMyListingDto(
  listing: Doc<"listings">,
  params: {
    availability: ListingAvailability;
    images: Array<{ url: string }>;
    pendingRequestCount: number;
    hasActiveApprovedLoan: boolean;
  },
) {
  return {
    _id: listing._id,
    name: listing.name,
    category: listing.category,
    condition: listing.condition,
    description: listing.description,
    availability: params.availability,
    images: params.images,
    pendingRequestCount: params.pendingRequestCount,
    hasActiveApprovedLoan: params.hasActiveApprovedLoan,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

export function toEditableListingDto(
  listing: Doc<"listings">,
  params: {
    images: Array<{ storageId: Doc<"listingImageUploads">["storageId"]; url: string }>;
    pendingRequestCount: number;
    hasActiveApprovedLoan: boolean;
  },
) {
  return {
    _id: listing._id,
    name: listing.name,
    category: listing.category,
    condition: listing.condition,
    description: listing.description,
    images: params.images,
    pendingRequestCount: params.pendingRequestCount,
    hasActiveApprovedLoan: params.hasActiveApprovedLoan,
  };
}
