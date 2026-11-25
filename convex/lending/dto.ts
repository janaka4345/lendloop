import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  automationActivityStatusValidator,
  automationEventTypeValidator,
  automationRecipientRoleValidator,
  listingCategoryValidator,
  loanStatusValidator,
} from "../schema";

export const loanAutomationActivityDtoValidator = v.object({
  _id: v.id("automationActivities"),
  eventType: automationEventTypeValidator,
  status: automationActivityStatusValidator,
  attemptCount: v.number(),
  recipientRole: automationRecipientRoleValidator,
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const loanCounterpartyDtoValidator = v.object({
  id: v.id("users"),
  displayName: v.string(),
  trustedLender: v.boolean(),
});

export const loanListingSummaryDtoValidator = v.object({
  id: v.id("listings"),
  name: v.string(),
  category: listingCategoryValidator,
  isArchived: v.boolean(),
});

export const loanCardDtoValidator = v.object({
  _id: v.id("loans"),
  status: loanStatusValidator,
  isOverdue: v.boolean(),
  startDate: v.string(),
  endDate: v.string(),
  note: v.optional(v.string()),
  decisionReason: v.optional(v.string()),
  returnedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  viewerRole: v.union(v.literal("borrower"), v.literal("lender"), v.literal("admin")),
  listing: loanListingSummaryDtoValidator,
  counterparty: loanCounterpartyDtoValidator,
  canApprove: v.boolean(),
  canDecline: v.boolean(),
  canCancel: v.boolean(),
  canMarkReturned: v.boolean(),
  conflictingPendingCount: v.number(),
  automationActivities: v.array(loanAutomationActivityDtoValidator),
});

export const loanSectionsDtoValidator = v.object({
  overdue: v.array(loanCardDtoValidator),
  active: v.array(loanCardDtoValidator),
  history: v.array(loanCardDtoValidator),
});

export function toLoanAutomationActivityDto(
  activity: Doc<"automationActivities">,
  includeLastError: boolean,
) {
  return {
    _id: activity._id,
    eventType: activity.eventType,
    status: activity.status,
    attemptCount: activity.attemptCount,
    recipientRole: activity.recipientRole,
    ...(includeLastError && activity.lastError !== undefined
      ? { lastError: activity.lastError }
      : {}),
    createdAt: activity.createdAt,
    ...(activity.completedAt !== undefined ? { completedAt: activity.completedAt } : {}),
  };
}

export function toLoanCardDto(
  loan: Doc<"loans">,
  params: {
    viewerRole: "borrower" | "lender" | "admin";
    isOverdue: boolean;
    listing: Doc<"listings"> | null;
    counterparty: Doc<"users"> | null;
    canApprove: boolean;
    canDecline: boolean;
    canCancel: boolean;
    canMarkReturned: boolean;
    conflictingPendingCount: number;
    automationActivities: ReadonlyArray<Doc<"automationActivities">>;
    includeLastError: boolean;
  },
) {
  return {
    _id: loan._id,
    status: loan.status,
    isOverdue: params.isOverdue,
    startDate: loan.startDate,
    endDate: loan.endDate,
    ...(loan.note !== undefined ? { note: loan.note } : {}),
    ...(loan.decisionReason !== undefined ? { decisionReason: loan.decisionReason } : {}),
    ...(loan.returnedAt !== undefined ? { returnedAt: loan.returnedAt } : {}),
    createdAt: loan.createdAt,
    updatedAt: loan.updatedAt,
    viewerRole: params.viewerRole,
    listing: {
      id: loan.listingId,
      name: params.listing?.name ?? "Removed Listing",
      category: params.listing?.category ?? "other",
      isArchived: params.listing === null || params.listing.archivedAt !== undefined,
    },
    counterparty: {
      id: params.viewerRole === "borrower" ? loan.lenderId : loan.borrowerId,
      displayName: params.counterparty?.displayName ?? "Deleted User",
      trustedLender: params.counterparty?.trustedLender ?? false,
    },
    canApprove: params.canApprove,
    canDecline: params.canDecline,
    canCancel: params.canCancel,
    canMarkReturned: params.canMarkReturned,
    conflictingPendingCount: params.conflictingPendingCount,
    automationActivities: params.automationActivities.map((activity) =>
      toLoanAutomationActivityDto(activity, params.includeLastError),
    ),
  };
}
