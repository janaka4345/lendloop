import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { todayUtcDate, validateLoanDateRange } from "../../src/domain/dates";
import { canTransitionLoan, findOverlappingLoans, isLoanOverdue } from "../../src/domain/loan";
import { DOMAIN_LIMITS } from "../../src/domain/types";
import { recordAuditLog } from "../audit/seam";
import { enqueueAutomationActivity } from "../automation/seam";
import { requireCurrentUser, requireLoanParticipant } from "../lib/authz";
import { createAppError } from "../lib/errors";
import { enforceRateLimit } from "../lib/rateLimit";

const LOAN_CONFLICT_SCAN_BOUND = 100;
const AUTO_DECLINE_REASON = "Dates no longer available";

/**
 * Submits a new `pending` Loan request from the authenticated Borrower.
 * Enforces `Borrower !== Lender`, active Listing, valid inclusive UTC date range (<= 30 days),
 * non-overlap with existing `approved` Loans, atomic Audit Log, and pending Automation Activity.
 */
export const requestLoan = mutation({
  args: {
    listingId: v.id("listings"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.object({
    _id: v.id("loans"),
  }),
  handler: async (ctx, args) => {
    const borrower = await requireCurrentUser(ctx);
    await enforceRateLimit(ctx, "loanWrite", borrower._id);

    const listing = await ctx.db.get(args.listingId);
    if (!listing) {
      throw createAppError("NOT_FOUND", "Listing not found.");
    }
    if (listing.archivedAt !== undefined) {
      throw createAppError("CONFLICT", "This Listing has been removed and cannot be borrowed.");
    }
    if (listing.lenderId === borrower._id) {
      throw createAppError("FORBIDDEN", "You cannot borrow your own Listing.", {
        actorId: borrower._id,
        targetType: "listing",
        targetId: listing._id,
      });
    }

    const trimmedNote = (args.note ?? "").trim();
    if (trimmedNote.length > DOMAIN_LIMITS.MAX_LOAN_NOTE_LENGTH) {
      throw createAppError(
        "VALIDATION_ERROR",
        `Note cannot exceed ${DOMAIN_LIMITS.MAX_LOAN_NOTE_LENGTH} characters.`,
      );
    }

    const todayUtc = todayUtcDate();
    const dateValidation = validateLoanDateRange(args.startDate, args.endDate, todayUtc);
    if (!dateValidation.ok) {
      throw createAppError("VALIDATION_ERROR", dateValidation.message);
    }

    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) =>
        q.eq("listingId", listing._id).eq("status", "approved"),
      )
      .take(LOAN_CONFLICT_SCAN_BOUND);

    const overlappingApproved = findOverlappingLoans(
      { startDate: args.startDate, endDate: args.endDate },
      approvedLoans,
    );
    if (overlappingApproved.length > 0) {
      throw createAppError(
        "CONFLICT",
        "Those dates overlap an already approved Loan. Please choose different dates.",
      );
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      listingId: listing._id,
      lenderId: listing.lenderId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorId: borrower._id,
      actorRole: borrower.role,
      action: "loan.requested",
      targetType: "loan",
      targetId: loanId,
      metadata: {
        listingId: listing._id,
        startDate: args.startDate,
        endDate: args.endDate,
        durationDays: dateValidation.durationDays,
      },
    });

    await enqueueAutomationActivity(ctx, {
      loanId,
      eventType: "loan_requested",
      idempotencyKey: `loan_requested:${loanId}`,
      recipientRole: "lender",
    });

    return { _id: loanId };
  },
});

/**
 * Approves a `pending` Loan as the Lender.
 * - Rejects if the date range overlaps any existing `approved` Loan.
 * - Atomically auto-declines all competing overlapping `pending` Loans on the same Listing,
 *   recording `"Dates no longer available"`, Audit Log entries, and `loan_declined` Automation Activity.
 */
export const approveLoan = mutation({
  args: {
    loanId: v.id("loans"),
  },
  returns: v.object({
    _id: v.id("loans"),
    autoDeclinedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, loan, participantRole } = await requireLoanParticipant(ctx, args.loanId);
    if (participantRole !== "lender") {
      throw createAppError("FORBIDDEN", "Only the Lender can approve a pending Loan.", {
        actorId: user._id,
        targetType: "loan",
        targetId: loan._id,
      });
    }

    await enforceRateLimit(ctx, "loanWrite", user._id);

    const todayUtc = todayUtcDate();
    const transition = canTransitionLoan({
      from: loan.status,
      to: "approved",
      actor: "lender",
      startDate: loan.startDate,
      todayUtc,
    });
    if (!transition.ok) {
      throw createAppError("CONFLICT", transition.reason);
    }

    const listing = await ctx.db.get(loan.listingId);
    if (!listing || listing.archivedAt !== undefined) {
      throw createAppError("CONFLICT", "Cannot approve a Loan for a removed Listing.");
    }

    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) =>
        q.eq("listingId", loan.listingId).eq("status", "approved"),
      )
      .take(LOAN_CONFLICT_SCAN_BOUND);

    const overlappingApproved = findOverlappingLoans(loan, approvedLoans);
    if (overlappingApproved.length > 0) {
      throw createAppError(
        "CONFLICT",
        "Cannot approve because these dates overlap an already approved Loan.",
      );
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "approved",
      updatedAt: now,
    });

    const pendingLoans = await ctx.db
      .query("loans")
      .withIndex("by_listing_status", (q) =>
        q.eq("listingId", loan.listingId).eq("status", "pending"),
      )
      .take(LOAN_CONFLICT_SCAN_BOUND);

    const competingPending = findOverlappingLoans(
      loan,
      pendingLoans.filter((candidate) => candidate._id !== loan._id),
    );

    for (const competing of competingPending) {
      await ctx.db.patch(competing._id, {
        status: "declined",
        decisionReason: AUTO_DECLINE_REASON,
        updatedAt: now,
      });

      await recordAuditLog(ctx, {
        actorRole: "system",
        action: "loan.declined",
        targetType: "loan",
        targetId: competing._id,
        metadata: {
          listingId: loan.listingId,
          autoDeclined: true,
          conflictingLoanId: loan._id,
        },
      });

      await enqueueAutomationActivity(ctx, {
        loanId: competing._id,
        eventType: "loan_declined",
        idempotencyKey: `loan_declined:${competing._id}`,
        recipientRole: "borrower",
      });
    }

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "loan.approved",
      targetType: "loan",
      targetId: loan._id,
      metadata: {
        listingId: loan.listingId,
        autoDeclinedCount: competingPending.length,
      },
    });

    await enqueueAutomationActivity(ctx, {
      loanId: loan._id,
      eventType: "loan_approved",
      idempotencyKey: `loan_approved:${loan._id}`,
      recipientRole: "borrower",
    });

    return {
      _id: loan._id,
      autoDeclinedCount: competingPending.length,
    };
  },
});

/**
 * Declines a `pending` Loan as the Lender with an optional `decisionReason`.
 */
export const declineLoan = mutation({
  args: {
    loanId: v.id("loans"),
    decisionReason: v.optional(v.string()),
  },
  returns: v.object({
    _id: v.id("loans"),
  }),
  handler: async (ctx, args) => {
    const { user, loan, participantRole } = await requireLoanParticipant(ctx, args.loanId);
    if (participantRole !== "lender") {
      throw createAppError("FORBIDDEN", "Only the Lender can decline a pending Loan.", {
        actorId: user._id,
        targetType: "loan",
        targetId: loan._id,
      });
    }

    await enforceRateLimit(ctx, "loanWrite", user._id);

    const trimmedReason = (args.decisionReason ?? "").trim();
    if (trimmedReason.length > DOMAIN_LIMITS.MAX_REASON_LENGTH) {
      throw createAppError(
        "VALIDATION_ERROR",
        `Reason cannot exceed ${DOMAIN_LIMITS.MAX_REASON_LENGTH} characters.`,
      );
    }

    const todayUtc = todayUtcDate();
    const transition = canTransitionLoan({
      from: loan.status,
      to: "declined",
      actor: "lender",
      startDate: loan.startDate,
      todayUtc,
    });
    if (!transition.ok) {
      throw createAppError("CONFLICT", transition.reason);
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "declined",
      ...(trimmedReason.length > 0 ? { decisionReason: trimmedReason } : {}),
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "loan.declined",
      targetType: "loan",
      targetId: loan._id,
      metadata: {
        listingId: loan.listingId,
        autoDeclined: false,
        hasReason: trimmedReason.length > 0,
      },
    });

    await enqueueAutomationActivity(ctx, {
      loanId: loan._id,
      eventType: "loan_declined",
      idempotencyKey: `loan_declined:${loan._id}`,
      recipientRole: "borrower",
    });

    return { _id: loan._id };
  },
});

/**
 * Cancels a Loan:
 * - `pending`: Borrower only
 * - `approved`: Borrower or Lender, strictly before `startDate`
 */
export const cancelLoan = mutation({
  args: {
    loanId: v.id("loans"),
  },
  returns: v.object({
    _id: v.id("loans"),
  }),
  handler: async (ctx, args) => {
    const { user, loan, participantRole } = await requireLoanParticipant(ctx, args.loanId);
    await enforceRateLimit(ctx, "loanWrite", user._id);

    const todayUtc = todayUtcDate();
    const transition = canTransitionLoan({
      from: loan.status,
      to: "cancelled",
      actor: participantRole,
      startDate: loan.startDate,
      todayUtc,
    });
    if (!transition.ok) {
      const code =
        loan.status === "pending" && participantRole === "lender" ? "FORBIDDEN" : "CONFLICT";
      throw createAppError(code, transition.reason, {
        actorId: user._id,
        targetType: "loan",
        targetId: loan._id,
      });
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "cancelled",
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "loan.cancelled",
      targetType: "loan",
      targetId: loan._id,
      metadata: {
        listingId: loan.listingId,
        cancelledBy: participantRole,
        previousStatus: loan.status,
      },
    });

    await enqueueAutomationActivity(ctx, {
      loanId: loan._id,
      eventType: "loan_cancelled",
      idempotencyKey: `loan_cancelled:${loan._id}`,
      recipientRole: participantRole === "borrower" ? "lender" : "borrower",
    });

    return { _id: loan._id };
  },
});

/**
 * Marks an `approved` Loan as `returned` as the Lender.
 * Explicitly permitted early, on-time, or Overdue — even if the Listing was archived by an Admin.
 */
export const markLoanReturned = mutation({
  args: {
    loanId: v.id("loans"),
  },
  returns: v.object({
    _id: v.id("loans"),
    returnedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, loan, participantRole } = await requireLoanParticipant(ctx, args.loanId);
    if (participantRole !== "lender") {
      throw createAppError("FORBIDDEN", "Only the Lender can mark an approved Loan as returned.", {
        actorId: user._id,
        targetType: "loan",
        targetId: loan._id,
      });
    }

    await enforceRateLimit(ctx, "loanWrite", user._id);

    const todayUtc = todayUtcDate();
    const transition = canTransitionLoan({
      from: loan.status,
      to: "returned",
      actor: "lender",
      startDate: loan.startDate,
      todayUtc,
    });
    if (!transition.ok) {
      throw createAppError("CONFLICT", transition.reason);
    }

    const now = Date.now();
    const wasOverdue = isLoanOverdue(loan, todayUtc);

    await ctx.db.patch(loan._id, {
      status: "returned",
      returnedAt: now,
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorId: user._id,
      actorRole: user.role,
      action: "loan.returned",
      targetType: "loan",
      targetId: loan._id,
      metadata: {
        listingId: loan.listingId,
        wasOverdue,
      },
    });

    await enqueueAutomationActivity(ctx, {
      loanId: loan._id,
      eventType: "loan_returned",
      idempotencyKey: `loan_returned:${loan._id}`,
      recipientRole: "borrower",
    });

    return { _id: loan._id, returnedAt: now };
  },
});
