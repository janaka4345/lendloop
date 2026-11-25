import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { calculateInclusiveDays, todayUtcDate } from "../../src/domain/dates";
import { redactText } from "../../src/domain/redaction";
import {
  automationActivityStatusValidator,
  automationEventTypeValidator,
  automationRecipientRoleValidator,
} from "../schema";

const MAX_OVERDUE_BATCH_SIZE = 100;
const MAX_ERROR_SUMMARY_LENGTH = 300;

function sanitizeErrorSummary(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const trimmed = redactText(error).trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_ERROR_SUMMARY_LENGTH);
}

export const getNotificationContext = internalQuery({
  args: {
    activityId: v.id("automationActivities"),
  },
  returns: v.union(
    v.null(),
    v.object({
      activity: v.object({
        _id: v.id("automationActivities"),
        loanId: v.id("loans"),
        eventType: automationEventTypeValidator,
        idempotencyKey: v.string(),
        status: automationActivityStatusValidator,
        attemptCount: v.number(),
        recipientRole: automationRecipientRoleValidator,
      }),
      loan: v.object({
        _id: v.id("loans"),
        startDate: v.string(),
        endDate: v.string(),
        note: v.optional(v.string()),
        decisionReason: v.optional(v.string()),
      }),
      listing: v.object({
        _id: v.id("listings"),
        name: v.string(),
        archivedAt: v.optional(v.number()),
      }),
      recipient: v.union(
        v.null(),
        v.object({
          _id: v.id("users"),
          email: v.string(),
          displayName: v.string(),
          deletedAt: v.optional(v.number()),
        }),
      ),
      counterpartyName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity) return null;

    const loan = await ctx.db.get(activity.loanId);
    if (!loan) return null;

    const listing = await ctx.db.get(loan.listingId);
    if (!listing) return null;

    const [lender, borrower] = await Promise.all([
      ctx.db.get(loan.lenderId),
      ctx.db.get(loan.borrowerId),
    ]);

    const recipientDoc = activity.recipientRole === "lender" ? lender : borrower;
    const counterpartyDoc = activity.recipientRole === "lender" ? borrower : lender;

    return {
      activity: {
        _id: activity._id,
        loanId: activity.loanId,
        eventType: activity.eventType,
        idempotencyKey: activity.idempotencyKey,
        status: activity.status,
        attemptCount: activity.attemptCount,
        recipientRole: activity.recipientRole,
      },
      loan: {
        _id: loan._id,
        startDate: loan.startDate,
        endDate: loan.endDate,
        ...(loan.note !== undefined ? { note: loan.note } : {}),
        ...(loan.decisionReason !== undefined ? { decisionReason: loan.decisionReason } : {}),
      },
      listing: {
        _id: listing._id,
        name: listing.name,
        ...(listing.archivedAt !== undefined ? { archivedAt: listing.archivedAt } : {}),
      },
      recipient: recipientDoc
        ? {
            _id: recipientDoc._id,
            email: recipientDoc.email,
            displayName: recipientDoc.displayName,
            ...(recipientDoc.deletedAt !== undefined ? { deletedAt: recipientDoc.deletedAt } : {}),
          }
        : null,
      counterpartyName: counterpartyDoc?.displayName ?? "Deleted User",
    };
  },
});

export const recordDeliveryOutcome = internalMutation({
  args: {
    activityId: v.id("automationActivities"),
    status: automationActivityStatusValidator,
    attemptCount: v.number(),
    lastError: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityId);
    if (!activity || activity.status === "sent") {
      return null;
    }

    const sanitizedError = sanitizeErrorSummary(args.lastError);
    await ctx.db.patch(args.activityId, {
      status: args.status,
      attemptCount: args.attemptCount,
      ...(args.status === "sent"
        ? { lastError: undefined }
        : sanitizedError !== undefined
          ? { lastError: sanitizedError }
          : {}),
      ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
    });

    return null;
  },
});

export const listOverdueLoansBatch = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    todayUtc: v.optional(v.string()),
  },
  returns: v.object({
    items: v.array(
      v.object({
        loanId: v.id("loans"),
        idempotencyKey: v.string(),
        borrowerEmail: v.string(),
        borrowerName: v.string(),
        lenderName: v.string(),
        listingName: v.string(),
        listingRemoved: v.boolean(),
        startDate: v.string(),
        endDate: v.string(),
        daysOverdue: v.number(),
      }),
    ),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    todayUtc: v.string(),
  }),
  handler: async (ctx, args) => {
    const todayUtc = args.todayUtc ?? todayUtcDate();
    const numItems = Math.min(
      MAX_OVERDUE_BATCH_SIZE,
      Math.max(1, Math.floor(args.limit ?? MAX_OVERDUE_BATCH_SIZE)),
    );

    const page = await ctx.db
      .query("loans")
      .withIndex("by_status_end_date", (q) => q.eq("status", "approved").lt("endDate", todayUtc))
      .paginate({
        numItems,
        cursor: args.cursor ?? null,
      });

    const items: Array<{
      loanId: (typeof page.page)[number]["_id"];
      idempotencyKey: string;
      borrowerEmail: string;
      borrowerName: string;
      lenderName: string;
      listingName: string;
      listingRemoved: boolean;
      startDate: string;
      endDate: string;
      daysOverdue: number;
    }> = [];

    for (const loan of page.page) {
      const idempotencyKey = `overdue_reminder:${loan._id}:${todayUtc}`;
      const existingActivity = await ctx.db
        .query("automationActivities")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();

      if (existingActivity && existingActivity.status === "sent") {
        continue;
      }

      const [borrower, lender, listing] = await Promise.all([
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.lenderId),
        ctx.db.get(loan.listingId),
      ]);

      if (!borrower || borrower.deletedAt !== undefined || !borrower.email.trim()) {
        continue;
      }
      if (!listing) {
        continue;
      }

      const daysOverdue = Math.max(1, calculateInclusiveDays(loan.endDate, todayUtc) - 1);

      items.push({
        loanId: loan._id,
        idempotencyKey,
        borrowerEmail: borrower.email,
        borrowerName: borrower.displayName,
        lenderName: lender?.displayName ?? "Deleted User",
        listingName: listing.name,
        listingRemoved: listing.archivedAt !== undefined,
        startDate: loan.startDate,
        endDate: loan.endDate,
        daysOverdue,
      });
    }

    return {
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      todayUtc,
    };
  },
});

export const ackOverdueReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    attemptCount: v.number(),
    lastError: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      found: v.literal(false),
    }),
    v.object({
      found: v.literal(true),
      duplicate: v.boolean(),
      activityId: v.id("automationActivities"),
      status: v.union(v.literal("sent"), v.literal("failed")),
    }),
  ),
  handler: async (ctx, args) => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      return { found: false as const };
    }

    const now = Date.now();
    const sanitizedError =
      args.status === "failed" ? sanitizeErrorSummary(args.lastError) : undefined;
    const normalizedAttemptCount = Math.max(1, Math.floor(args.attemptCount));

    const existing = await ctx.db
      .query("automationActivities")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (existing) {
      if (existing.status === "sent") {
        return {
          found: true as const,
          duplicate: true,
          activityId: existing._id,
          status: "sent" as const,
        };
      }

      const isDuplicate = existing.status === args.status;
      await ctx.db.patch(existing._id, {
        status: args.status,
        attemptCount: Math.max(existing.attemptCount, normalizedAttemptCount),
        lastError: sanitizedError,
        completedAt: now,
      });

      return {
        found: true as const,
        duplicate: isDuplicate,
        activityId: existing._id,
        status: args.status,
      };
    }

    const activityId = await ctx.db.insert("automationActivities", {
      loanId: args.loanId,
      eventType: "overdue_reminder",
      idempotencyKey: args.idempotencyKey,
      status: args.status,
      attemptCount: normalizedAttemptCount,
      recipientRole: "borrower",
      ...(sanitizedError !== undefined ? { lastError: sanitizedError } : {}),
      createdAt: now,
      completedAt: now,
    });

    return {
      found: true as const,
      duplicate: false,
      activityId,
      status: args.status,
    };
  },
});
