import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { sanitizeAuditMetadata } from "../../src/domain/redaction";
import type { AuditAction, AuditActorRole, AuditTargetType } from "../../src/domain/types";

export interface RecordAuditLogInput {
  actorId?: Id<"users">;
  actorRole: AuditActorRole;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Atomically records a non-PII Audit Log entry inside the caller's mutation transaction.
 * Any PII/secret fields or patterns in `metadata` are stripped/redacted before insertion.
 */
export async function recordAuditLog(
  ctx: MutationCtx,
  input: RecordAuditLogInput,
): Promise<Id<"auditLogs">> {
  const sanitizedMetadata = sanitizeAuditMetadata(input.metadata);
  return ctx.db.insert("auditLogs", {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
    createdAt: Date.now(),
  });
}
