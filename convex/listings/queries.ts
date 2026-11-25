import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { todayUtcDate } from "../../src/domain/dates";
import { deriveListingAvailability } from "../../src/domain/loan";
import { DOMAIN_LIMITS } from "../../src/domain/types";
import { requireCurrentUser, requireListingLender } from "../lib/authz";
import { createAppError } from "../lib/errors";
import { listingCategoryValidator } from "../schema";
import {
  catalogListingDtoValidator,
  editableListingDtoValidator,
  listingDetailDtoValidator,
  myListingDtoValidator,
  publicListingDtoValidator,
  toCatalogListingDto,
  toEditableListingDto,
  toListingDetailDto,
  toMyListingDto,
  toPublicListingDto,
} from "./dto";
import { resolveEditableListingImages, resolveListingImageUrls } from "./images";

const LOAN_LOOKUP_BOUND = 100;

function clampPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DOMAIN_LIMITS.MAX_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit), 1), DOMAIN_LIMITS.MAX_PAGE_SIZE);
}

async function getListingLoanSnapshot(ctx: QueryCtx, listingId: Id<"listings">, todayUtc: string) {
  const [approvedLoans, pendingLoans] = await Promise.all([
    ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) => q.eq("listingId", listingId).eq("status", "approved"))
      .take(LOAN_LOOKUP_BOUND),
    ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) => q.eq("listingId", listingId).eq("status", "pending"))
      .take(LOAN_LOOKUP_BOUND),
  ]);

  return {
    availability: deriveListingAvailability(approvedLoans, todayUtc),
    hasActiveApprovedLoan: approvedLoans.length > 0,
    pendingRequestCount: pendingLoans.length,
  };
}

/**
 * Unauthenticated public landing query (`/`).
 * Returns ONLY active Listings that are `Available` today using the strict allow-listed Public DTO.
 */
export const listPublicAvailableListings = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(publicListingDtoValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const numItems = clampPageSize(args.limit);
    const pageResult = await ctx.db
      .query("listings")
      .withIndex("by_archived_category", (q) => q.eq("archivedAt", undefined))
      .order("desc")
      .paginate({
        numItems,
        cursor: args.cursor ?? null,
      });

    const todayUtc = todayUtcDate();
    const items = [];

    for (const listing of pageResult.page) {
      const approvedLoans = await ctx.db
        .query("loans")
        .withIndex("by_listing_status", (q) =>
          q.eq("listingId", listing._id).eq("status", "approved"),
        )
        .take(LOAN_LOOKUP_BOUND);

      if (deriveListingAvailability(approvedLoans, todayUtc) !== "Available") {
        continue;
      }

      const images = await resolveListingImageUrls(ctx, listing.imageIds);
      items.push(toPublicListingDto(listing, images));
    }

    return {
      items,
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});

/**
 * Authenticated *All Tools* catalog query (`/listings`).
 * Supports server-indexed name search, Category filtering, "Available today only" filtering,
 * and 50-item "Load more" pagination.
 */
export const listCatalogListings = query({
  args: {
    search: v.optional(v.string()),
    category: v.optional(listingCategoryValidator),
    availableOnly: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(catalogListingDtoValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);

    const numItems = clampPageSize(args.limit);
    const trimmedSearch = (args.search ?? "").trim();

    const pageResult =
      trimmedSearch.length > 0
        ? await ctx.db
            .query("listings")
            .withSearchIndex("search_name", (q) => {
              const base = q.search("name", trimmedSearch).eq("archivedAt", undefined);
              return args.category ? base.eq("category", args.category) : base;
            })
            .paginate({
              numItems,
              cursor: args.cursor ?? null,
            })
        : args.category
          ? await ctx.db
              .query("listings")
              .withIndex("by_archived_category", (q) =>
                q.eq("archivedAt", undefined).eq("category", args.category!),
              )
              .order("desc")
              .paginate({
                numItems,
                cursor: args.cursor ?? null,
              })
          : await ctx.db
              .query("listings")
              .withIndex("by_archived_category", (q) => q.eq("archivedAt", undefined))
              .order("desc")
              .paginate({
                numItems,
                cursor: args.cursor ?? null,
              });

    const todayUtc = todayUtcDate();
    const lenderCache = new Map<Id<"users">, Awaited<ReturnType<typeof ctx.db.get<"users">>>>();
    const items = [];

    for (const listing of pageResult.page) {
      const approvedLoans = await ctx.db
        .query("loans")
        .withIndex("by_listing_status", (q) =>
          q.eq("listingId", listing._id).eq("status", "approved"),
        )
        .take(LOAN_LOOKUP_BOUND);

      const availability = deriveListingAvailability(approvedLoans, todayUtc);
      if (args.availableOnly && availability !== "Available") {
        continue;
      }

      let lender = lenderCache.get(listing.lenderId);
      if (lender === undefined) {
        lender = await ctx.db.get(listing.lenderId);
        lenderCache.set(listing.lenderId, lender);
      }

      const images = await resolveListingImageUrls(ctx, listing.imageIds);
      items.push(
        toCatalogListingDto(listing, {
          availability,
          images,
          lender,
        }),
      );
    }

    return {
      items,
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});

/**
 * Authenticated *My Listings* query (`/my-listings`).
 * Lists the signed-in Lender's active Listings with derived Availability and pending-request counts.
 */
export const listMyListings = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(myListingDtoValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const numItems = clampPageSize(args.limit);

    const pageResult = await ctx.db
      .query("listings")
      .withIndex("by_lender_archived", (q) =>
        q.eq("lenderId", user._id).eq("archivedAt", undefined),
      )
      .order("desc")
      .paginate({
        numItems,
        cursor: args.cursor ?? null,
      });

    const todayUtc = todayUtcDate();
    const items = [];

    for (const listing of pageResult.page) {
      const [snapshot, images] = await Promise.all([
        getListingLoanSnapshot(ctx, listing._id, todayUtc),
        resolveListingImageUrls(ctx, listing.imageIds),
      ]);

      items.push(
        toMyListingDto(listing, {
          availability: snapshot.availability,
          images,
          pendingRequestCount: snapshot.pendingRequestCount,
          hasActiveApprovedLoan: snapshot.hasActiveApprovedLoan,
        }),
      );
    }

    return {
      items,
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});

/**
 * Authenticated Lender-only edit query (`/listings/[id]/edit`).
 * Strictly enforced on the server via `requireListingLender`.
 */
export const getListingForEdit = query({
  args: {
    listingId: v.id("listings"),
  },
  returns: editableListingDtoValidator,
  handler: async (ctx, args) => {
    const { listing } = await requireListingLender(ctx, args.listingId);

    if (listing.archivedAt !== undefined) {
      throw createAppError("NOT_FOUND", "Archived Listings cannot be edited.");
    }

    const todayUtc = todayUtcDate();
    const [snapshot, images] = await Promise.all([
      getListingLoanSnapshot(ctx, listing._id, todayUtc),
      resolveEditableListingImages(ctx, listing.imageIds),
    ]);

    return toEditableListingDto(listing, {
      images,
      pendingRequestCount: snapshot.pendingRequestCount,
      hasActiveApprovedLoan: snapshot.hasActiveApprovedLoan,
    });
  },
});

/**
 * Authenticated Listing detail query (`/listings/[id]`).
 * - Active Listings are visible to all signed-in Users.
 * - Archived Listings are visible read-only ONLY to the Lender, Borrowers with a Loan on the Listing,
 *   or an Admin; unrelated Users receive `NOT_FOUND`.
 * - Upcoming `approved` booked date ranges omit all Borrower identities.
 */
export const getListingDetail = query({
  args: {
    listingId: v.id("listings"),
  },
  returns: listingDetailDtoValidator,
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const listing = await ctx.db.get(args.listingId);

    if (!listing) {
      throw createAppError("NOT_FOUND", "Listing not found.");
    }

    const isOwnListing = listing.lenderId === user._id;
    const isAdmin = user.role === "admin";

    if (listing.archivedAt !== undefined && !isOwnListing && !isAdmin) {
      const statuses = ["approved", "pending", "returned", "declined", "cancelled"] as const;
      let isParticipant = false;

      for (const status of statuses) {
        const borrowerLoans = await ctx.db
          .query("loans")
          .withIndex("by_borrower_status", (q) => q.eq("borrowerId", user._id).eq("status", status))
          .take(LOAN_LOOKUP_BOUND);
        if (borrowerLoans.some((loan) => loan.listingId === listing._id)) {
          isParticipant = true;
          break;
        }
      }

      if (!isParticipant) {
        throw createAppError("NOT_FOUND", "Listing not found.");
      }
    }

    const todayUtc = todayUtcDate();
    const [approvedLoans, pendingLoans, lender, images] = await Promise.all([
      ctx.db
        .query("loans")
        .withIndex("by_listing_status", (q) =>
          q.eq("listingId", listing._id).eq("status", "approved"),
        )
        .take(LOAN_LOOKUP_BOUND),
      ctx.db
        .query("loans")
        .withIndex("by_listing_status", (q) =>
          q.eq("listingId", listing._id).eq("status", "pending"),
        )
        .take(LOAN_LOOKUP_BOUND),
      ctx.db.get(listing.lenderId),
      resolveListingImageUrls(ctx, listing.imageIds),
    ]);

    const availability = deriveListingAvailability(approvedLoans, todayUtc);
    const bookedRanges = approvedLoans
      .filter((loan) => loan.endDate >= todayUtc)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((loan) => ({
        startDate: loan.startDate,
        endDate: loan.endDate,
      }));

    return toListingDetailDto(listing, {
      availability,
      images,
      lender,
      bookedRanges,
      isOwnListing,
      pendingRequestCount: pendingLoans.length,
    });
  },
});
