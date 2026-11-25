import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { sanitizeAuditMetadata } from "../../src/domain/redaction";
import { requireAdmin } from "../lib/authz";
import { clampPageSize } from "../lib/pagination";
import {
  auditActionValidator,
  auditActorRoleValidator,
  auditMetadataValidator,
  auditTargetTypeValidator,
} from "../schema";

const adminAuditLogDtoValidator = v.object({
  _id: v.id("auditLogs"),
  actorId: v.optional(v.id("users")),
  actorRole: auditActorRoleValidator,
  action: auditActionValidator,
  targetType: auditTargetTypeValidator,
  targetId: v.string(),
  metadata: v.optional(auditMetadataValidator),
  createdAt: v.number(),
});

function toAdminAuditLogDto(log: Doc<"auditLogs">) {
  const sanitized = sanitizeAuditMetadata(log.metadata);
  return {
    _id: log._id,
    ...(log.actorId !== undefined ? { actorId: log.actorId } : {}),
    actorRole: log.actorRole,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    ...(sanitized !== undefined ? { metadata: sanitized } : {}),
    createdAt: log.createdAt,
  };
}

/**
 * Admin-only read-only, paginated Audit Log query (`/admin` → Audit Log tab).
 * Filterable by canonical `AuditAction`, containing zero PII in metadata.
 */
export const listAuditLogs = query({
  args: {
    action: v.optional(auditActionValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(adminAuditLogDtoValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const numItems = clampPageSize(args.limit);

    const pageResult =
      args.action !== undefined
        ? await ctx.db
            .query("auditLogs")
            .withIndex("by_action", (q) => q.eq("action", args.action!))
            .order("desc")
            .paginate({ numItems, cursor: args.cursor ?? null })
        : await ctx.db
            .query("auditLogs")
            .withIndex("by_created")
            .order("desc")
            .paginate({ numItems, cursor: args.cursor ?? null });

    return {
      items: pageResult.page.map(toAdminAuditLogDto),
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});
