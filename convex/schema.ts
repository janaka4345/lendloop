import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const userRoleValidator = v.union(v.literal("user"), v.literal("admin"));

export const listingCategoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("hand_tools"),
  v.literal("automotive"),
  v.literal("cleaning"),
  v.literal("other"),
);

export const listingConditionValidator = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const automationEventTypeValidator = v.union(
  v.literal("loan_requested"),
  v.literal("loan_approved"),
  v.literal("loan_declined"),
  v.literal("loan_cancelled"),
  v.literal("loan_returned"),
  v.literal("overdue_reminder"),
);

export const automationActivityStatusValidator = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed"),
);

export const automationRecipientRoleValidator = v.union(v.literal("lender"), v.literal("borrower"));

export const auditActorRoleValidator = v.union(
  v.literal("user"),
  v.literal("admin"),
  v.literal("system"),
);

export const auditTargetTypeValidator = v.union(
  v.literal("user"),
  v.literal("listing"),
  v.literal("loan"),
);

export const auditActionValidator = v.union(
  v.literal("user.role_changed"),
  v.literal("user.trusted_lender_toggled"),
  v.literal("user.deleted"),
  v.literal("listing.created"),
  v.literal("listing.updated"),
  v.literal("listing.archived"),
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);

export const auditMetadataValidator = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean(), v.null()),
);

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    email: v.string(),
    displayName: v.string(),
    role: userRoleValidator,
    trustedLender: v.boolean(),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_role", ["role"]),

  listings: defineTable({
    lenderId: v.id("users"),
    name: v.string(),
    category: listingCategoryValidator,
    condition: listingConditionValidator,
    description: v.string(),
    imageIds: v.optional(v.array(v.id("_storage"))),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    archiveReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_archived_category", ["archivedAt", "category"])
    .index("by_lender_archived", ["lenderId", "archivedAt"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["archivedAt", "category"],
    }),

  listingImageUploads: defineTable({
    storageId: v.id("_storage"),
    uploaderId: v.id("users"),
    listingId: v.optional(v.id("listings")),
    status: v.union(v.literal("pending"), v.literal("attached")),
    contentType: v.string(),
    sizeBytes: v.number(),
    width: v.number(),
    height: v.number(),
    createdAt: v.number(),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_uploader_status", ["uploaderId", "status"])
    .index("by_storage_id", ["storageId"]),

  loans: defineTable({
    listingId: v.id("listings"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatusValidator,
    note: v.optional(v.string()),
    decisionReason: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_listing_status", ["listingId", "status"])
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_lender_status", ["lenderId", "status"])
    .index("by_status_end_date", ["status", "endDate"])
    .index("by_status_start_date", ["status", "startDate"]),

  automationActivities: defineTable({
    loanId: v.id("loans"),
    eventType: automationEventTypeValidator,
    idempotencyKey: v.string(),
    status: automationActivityStatusValidator,
    attemptCount: v.number(),
    recipientRole: automationRecipientRoleValidator,
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_loan_created", ["loanId", "createdAt"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_status", ["status"])
    .index("by_status_completed", ["status", "completedAt"]),

  auditLogs: defineTable({
    actorId: v.optional(v.id("users")),
    actorRole: auditActorRoleValidator,
    action: auditActionValidator,
    targetType: auditTargetTypeValidator,
    targetId: v.string(),
    metadata: v.optional(auditMetadataValidator),
    createdAt: v.number(),
  })
    .index("by_target", ["targetType", "targetId", "createdAt"])
    .index("by_actor", ["actorId", "createdAt"])
    .index("by_action", ["action", "createdAt"])
    .index("by_created", ["createdAt"]),
});
