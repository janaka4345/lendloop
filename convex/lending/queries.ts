import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { todayUtcDate } from "../../src/domain/dates";
import { canTransitionLoan, findOverlappingLoans, isLoanOverdue } from "../../src/domain/loan";
import { DOMAIN_LIMITS } from "../../src/domain/types";
import { requireAdmin, requireCurrentUser, requireLoanParticipantOrAdmin } from "../lib/authz";
import { loanStatusValidator } from "../schema";
import {
  adminLoanDtoValidator,
  loanCardDtoValidator,
  loanSectionsDtoValidator,
  toAdminLoanDto,
  toLoanCardDto,
} from "./dto";

const STATUS_QUERY_BOUND = DOMAIN_LIMITS.MAX_PAGE_SIZE;
const AUTOMATION_TIMELINE_LIMIT = 20;
const PENDING_BADGE_BOUND = 100;

function clampPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DOMAIN_LIMITS.MAX_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit), 1), DOMAIN_LIMITS.MAX_PAGE_SIZE);
}

async function hydrateLoanCard(
  ctx: QueryCtx,
  loan: Doc<"loans">,
  params: {
    viewerRole: "borrower" | "lender" | "admin";
    todayUtc: string;
    includeLastError: boolean;
    conflictingPendingCount: number;
    listingCache: Map<Id<"listings">, Doc<"listings"> | null>;
    userCache: Map<Id<"users">, Doc<"users"> | null>;
  },
) {
  let listing = params.listingCache.get(loan.listingId);
  if (listing === undefined) {
    listing = await ctx.db.get(loan.listingId);
    params.listingCache.set(loan.listingId, listing);
  }

  const counterpartyId = params.viewerRole === "borrower" ? loan.lenderId : loan.borrowerId;
  let counterparty = params.userCache.get(counterpartyId);
  if (counterparty === undefined) {
    counterparty = await ctx.db.get(counterpartyId);
    params.userCache.set(counterpartyId, counterparty);
  }

  const automationActivities = await ctx.db
    .query("automationActivities")
    .withIndex("by_loan_created", (q) => q.eq("loanId", loan._id))
    .order("desc")
    .take(AUTOMATION_TIMELINE_LIMIT);

  const actor = params.viewerRole === "admin" ? "system" : params.viewerRole;
  const listingArchived = listing === null || listing.archivedAt !== undefined;

  const canApprove =
    params.viewerRole === "lender" &&
    !listingArchived &&
    canTransitionLoan({
      from: loan.status,
      to: "approved",
      actor: "lender",
      startDate: loan.startDate,
      todayUtc: params.todayUtc,
    }).ok;

  const canDecline =
    params.viewerRole === "lender" &&
    canTransitionLoan({
      from: loan.status,
      to: "declined",
      actor: "lender",
      startDate: loan.startDate,
      todayUtc: params.todayUtc,
    }).ok;

  const canCancel =
    (actor === "borrower" || actor === "lender") &&
    canTransitionLoan({
      from: loan.status,
      to: "cancelled",
      actor,
      startDate: loan.startDate,
      todayUtc: params.todayUtc,
    }).ok;

  const canMarkReturned =
    params.viewerRole === "lender" &&
    canTransitionLoan({
      from: loan.status,
      to: "returned",
      actor: "lender",
      startDate: loan.startDate,
      todayUtc: params.todayUtc,
    }).ok;

  return toLoanCardDto(loan, {
    viewerRole: params.viewerRole,
    isOverdue: isLoanOverdue(loan, params.todayUtc),
    listing,
    counterparty,
    canApprove,
    canDecline,
    canCancel,
    canMarkReturned,
    conflictingPendingCount: params.conflictingPendingCount,
    automationActivities,
    includeLastError: params.includeLastError,
  });
}

async function listLoansByParty(
  ctx: QueryCtx,
  user: Doc<"users">,
  viewerRole: "borrower" | "lender",
) {
  const indexName = viewerRole === "borrower" ? "by_borrower_status" : "by_lender_status";
  const partyField = viewerRole === "borrower" ? "borrowerId" : "lenderId";

  const [approvedLoans, pendingLoans, returnedLoans, declinedLoans, cancelledLoans] =
    await Promise.all([
      ctx.db
        .query("loans")
        .withIndex(indexName, (q) =>
          q.eq(partyField as never, user._id as never).eq("status", "approved"),
        )
        .order("desc")
        .take(STATUS_QUERY_BOUND),
      ctx.db
        .query("loans")
        .withIndex(indexName, (q) =>
          q.eq(partyField as never, user._id as never).eq("status", "pending"),
        )
        .order("desc")
        .take(STATUS_QUERY_BOUND),
      ctx.db
        .query("loans")
        .withIndex(indexName, (q) =>
          q.eq(partyField as never, user._id as never).eq("status", "returned"),
        )
        .order("desc")
        .take(STATUS_QUERY_BOUND),
      ctx.db
        .query("loans")
        .withIndex(indexName, (q) =>
          q.eq(partyField as never, user._id as never).eq("status", "declined"),
        )
        .order("desc")
        .take(STATUS_QUERY_BOUND),
      ctx.db
        .query("loans")
        .withIndex(indexName, (q) =>
          q.eq(partyField as never, user._id as never).eq("status", "cancelled"),
        )
        .order("desc")
        .take(STATUS_QUERY_BOUND),
    ]);

  const todayUtc = todayUtcDate();
  const includeLastError = user.role === "admin";
  const listingCache = new Map<Id<"listings">, Doc<"listings"> | null>();
  const userCache = new Map<Id<"users">, Doc<"users"> | null>();

  // Group pending loans by listingId for lender conflictingPendingCount calculation
  const pendingByListing = new Map<Id<"listings">, Doc<"loans">[]>();
  if (viewerRole === "lender") {
    for (const loan of pendingLoans) {
      const bucket = pendingByListing.get(loan.listingId) ?? [];
      bucket.push(loan);
      pendingByListing.set(loan.listingId, bucket);
    }
  }

  const overdueRaw = approvedLoans
    .filter((loan) => isLoanOverdue(loan, todayUtc))
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  const activeApprovedRaw = approvedLoans
    .filter((loan) => !isLoanOverdue(loan, todayUtc))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const activeRaw = [...pendingLoans, ...activeApprovedRaw];

  const historyRaw = [...returnedLoans, ...declinedLoans, ...cancelledLoans]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, DOMAIN_LIMITS.MAX_PAGE_SIZE);

  const hydrate = (loan: Doc<"loans">) => {
    let conflictingPendingCount = 0;
    if (viewerRole === "lender" && loan.status === "pending") {
      const peers = (pendingByListing.get(loan.listingId) ?? []).filter((p) => p._id !== loan._id);
      conflictingPendingCount = findOverlappingLoans(loan, peers).length;
    }
    return hydrateLoanCard(ctx, loan, {
      viewerRole,
      todayUtc,
      includeLastError,
      conflictingPendingCount,
      listingCache,
      userCache,
    });
  };

  const [overdue, active, history] = await Promise.all([
    Promise.all(overdueRaw.map(hydrate)),
    Promise.all(activeRaw.map(hydrate)),
    Promise.all(historyRaw.map(hydrate)),
  ]);

  return { overdue, active, history };
}

/**
 * Authenticated *My Requests* query (`/my-requests`) for the signed-in Borrower.
 * Splits Loans into `overdue` (pinned at top), `active` (`pending` + non-overdue `approved`),
 * and `history` (`returned`, `declined`, `cancelled`).
 */
export const listMyRequests = query({
  args: {},
  returns: loanSectionsDtoValidator,
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return listLoansByParty(ctx, user, "borrower");
  },
});

/**
 * Authenticated *Incoming Requests* query (`/incoming-requests`) for the signed-in Lender.
 * Splits Loans into `overdue`, `active`, and `history`, and calculates `conflictingPendingCount`
 * for each `pending` Loan so approval dialogs warn about atomic auto-declines.
 */
export const listIncomingRequests = query({
  args: {},
  returns: loanSectionsDtoValidator,
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return listLoansByParty(ctx, user, "lender");
  },
});

/**
 * Lightweight reactive count of `pending` incoming requests for the navigation bar badge.
 */
export const getIncomingPendingCount = query({
  args: {},
  returns: v.object({
    count: v.number(),
  }),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_lender_status", (q) => q.eq("lenderId", user._id).eq("status", "pending"))
      .take(PENDING_BADGE_BOUND);

    return { count: pending.length };
  },
});

/**
 * Participant or Admin single-Loan lookup.
 * Enforces strict DTO privacy: omits `lastError` for non-Admins and omits counterparty PII.
 */
export const getLoanById = query({
  args: {
    loanId: v.id("loans"),
  },
  returns: loanCardDtoValidator,
  handler: async (ctx, args) => {
    const { user, loan, participantRole } = await requireLoanParticipantOrAdmin(ctx, args.loanId);
    const todayUtc = todayUtcDate();

    let conflictingPendingCount = 0;
    if (participantRole === "lender" && loan.status === "pending") {
      const pendingPeers = await ctx.db
        .query("loans")
        .withIndex("by_listing_status", (q) =>
          q.eq("listingId", loan.listingId).eq("status", "pending"),
        )
        .take(PENDING_BADGE_BOUND);
      conflictingPendingCount = findOverlappingLoans(
        loan,
        pendingPeers.filter((p) => p._id !== loan._id),
      ).length;
    }

    return hydrateLoanCard(ctx, loan, {
      viewerRole: participantRole,
      todayUtc,
      includeLastError: user.role === "admin",
      conflictingPendingCount,
      listingCache: new Map(),
      userCache: new Map(),
    });
  },
});

/**
 * Admin-only paginated All Loans query (`/admin` → All Loans tab).
 * Filterable by `status` and derived `Overdue` state, returning each Loan's expandable
 * `Automation Activity` timeline including sanitized `lastError` summaries.
 */
export const listAllLoansForAdmin = query({
  args: {
    status: v.optional(loanStatusValidator),
    overdueOnly: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(adminLoanDtoValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.overdueOnly && args.status !== undefined && args.status !== "approved") {
      return {
        items: [],
        continueCursor: "",
        isDone: true,
      };
    }

    const numItems = clampPageSize(args.limit);
    const todayUtc = todayUtcDate();

    const pageResult = args.overdueOnly
      ? await ctx.db
          .query("loans")
          .withIndex("by_status_end_date", (q) =>
            q.eq("status", "approved").lt("endDate", todayUtc),
          )
          .order("asc")
          .paginate({ numItems, cursor: args.cursor ?? null })
      : args.status !== undefined
        ? await ctx.db
            .query("loans")
            .withIndex("by_status_start_date", (q) => q.eq("status", args.status!))
            .order("desc")
            .paginate({ numItems, cursor: args.cursor ?? null })
        : await ctx.db
            .query("loans")
            .order("desc")
            .paginate({ numItems, cursor: args.cursor ?? null });

    const listingCache = new Map<Id<"listings">, Doc<"listings"> | null>();
    const userCache = new Map<Id<"users">, Doc<"users"> | null>();

    const items = await Promise.all(
      pageResult.page.map(async (loan) => {
        let listing = listingCache.get(loan.listingId);
        if (listing === undefined) {
          listing = await ctx.db.get(loan.listingId);
          listingCache.set(loan.listingId, listing);
        }

        let lender = userCache.get(loan.lenderId);
        if (lender === undefined) {
          lender = await ctx.db.get(loan.lenderId);
          userCache.set(loan.lenderId, lender);
        }

        let borrower = userCache.get(loan.borrowerId);
        if (borrower === undefined) {
          borrower = await ctx.db.get(loan.borrowerId);
          userCache.set(loan.borrowerId, borrower);
        }

        const automationActivities = await ctx.db
          .query("automationActivities")
          .withIndex("by_loan_created", (q) => q.eq("loanId", loan._id))
          .order("desc")
          .take(AUTOMATION_TIMELINE_LIMIT);

        return toAdminLoanDto(loan, {
          isOverdue: isLoanOverdue(loan, todayUtc),
          listing,
          lender,
          borrower,
          automationActivities,
        });
      }),
    );

    return {
      items,
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});
