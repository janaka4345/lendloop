import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AutomationEventType, AutomationRecipientRole } from "../../src/domain/types";

export interface EnqueueAutomationActivityInput {
  loanId: Id<"loans">;
  eventType: AutomationEventType;
  idempotencyKey: string;
  recipientRole: AutomationRecipientRole;
}

/**
 * Atomically enqueues a `pending` Automation Activity record inside the caller's mutation.
 * Idempotent on `idempotencyKey` so duplicate triggers never create duplicate outbox rows.
 */
export async function enqueueAutomationActivity(
  ctx: MutationCtx,
  input: EnqueueAutomationActivityInput,
): Promise<Id<"automationActivities">> {
  const existing = await ctx.db
    .query("automationActivities")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", input.idempotencyKey))
    .unique();

  if (existing) {
    return existing._id;
  }

  return ctx.db.insert("automationActivities", {
    loanId: input.loanId,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    status: "pending",
    attemptCount: 0,
    recipientRole: input.recipientRole,
    createdAt: Date.now(),
  });
}
