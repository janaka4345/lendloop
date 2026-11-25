import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { formatStructuredLog, redactText } from "../../src/domain/redaction";
import { computeRetryDelayMs, RETRY_DEFAULTS, shouldRetryHttpStatus } from "../../src/domain/retry";
import { sha256Hex, signAutomationJwt } from "./crypto";

export const deliverLoanNotification = internalAction({
  args: {
    activityId: v.id("automationActivities"),
    attempt: v.optional(v.number()),
  },
  returns: v.object({
    outcome: v.union(
      v.literal("sent"),
      v.literal("retrying"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempt: v.number(),
  }),
  handler: async (ctx, args) => {
    const attempt = Math.max(1, Math.floor(args.attempt ?? 1));
    const context = await ctx.runQuery(internal.automation.internal.getNotificationContext, {
      activityId: args.activityId,
    });

    if (!context || context.activity.status === "sent") {
      return { outcome: "skipped" as const, attempt };
    }

    if (
      !context.recipient ||
      context.recipient.deletedAt !== undefined ||
      !context.recipient.email.trim()
    ) {
      await ctx.runMutation(internal.automation.internal.recordDeliveryOutcome, {
        activityId: args.activityId,
        status: "failed",
        attemptCount: 0,
        lastError: "Skipped delivery: recipient User deleted or missing email.",
        completedAt: Date.now(),
      });
      console.info(
        formatStructuredLog({
          level: "info",
          event: "automation.delivery.skipped_deleted_recipient",
          context: {
            activityId: args.activityId,
            loanId: context.activity.loanId,
            eventType: context.activity.eventType,
          },
        }),
      );
      return { outcome: "skipped" as const, attempt: 0 };
    }

    const webhookUrl = (process.env.N8N_WEBHOOK_URL ?? "").trim();
    const jwtSecret = (process.env.N8N_JWT_SECRET ?? "").trim();
    if (!webhookUrl || !jwtSecret) {
      await ctx.runMutation(internal.automation.internal.recordDeliveryOutcome, {
        activityId: args.activityId,
        status: "failed",
        attemptCount: attempt,
        lastError: "Automation webhook is not configured.",
        completedAt: Date.now(),
      });
      console.warn(
        formatStructuredLog({
          level: "warn",
          event: "automation.delivery.misconfigured",
          code: "MISSING_AUTOMATION_CONFIG",
          context: {
            activityId: args.activityId,
            eventType: context.activity.eventType,
          },
        }),
      );
      return { outcome: "failed" as const, attempt };
    }

    const payload = {
      eventId: context.activity.idempotencyKey,
      eventType: context.activity.eventType,
      loanId: context.loan._id,
      listingName: context.listing.name,
      listingRemoved: context.listing.archivedAt !== undefined,
      recipientRole: context.activity.recipientRole,
      recipientEmail: context.recipient.email,
      recipientName: context.recipient.displayName,
      counterpartyName: context.counterpartyName,
      startDate: context.loan.startDate,
      endDate: context.loan.endDate,
      decisionReason: context.loan.decisionReason ?? null,
      note: context.loan.note ?? null,
      appUrl: (process.env.APP_URL ?? "http://localhost:3000").trim(),
    };

    const rawBody = JSON.stringify(payload);
    const bodySha256 = await sha256Hex(rawBody);
    const token = await signAutomationJwt({
      secret: jwtSecret,
      jti: context.activity.idempotencyKey,
      bodySha256,
    });

    let httpStatus = 0;
    let errorDetail = "";

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": context.activity.idempotencyKey,
        },
        body: rawBody,
      });

      httpStatus = response.status;
      if (response.ok) {
        const rawResponse = await response.text().catch(() => "");
        let parsedStatus: unknown = null;
        try {
          parsedStatus = (JSON.parse(rawResponse) as { status?: unknown })?.status;
        } catch {
          parsedStatus = null;
        }
        if (parsedStatus === "smtp_accepted" || parsedStatus === "duplicate") {
          await ctx.runMutation(internal.automation.internal.recordDeliveryOutcome, {
            activityId: args.activityId,
            status: "sent",
            attemptCount: attempt,
            completedAt: Date.now(),
          });
          return { outcome: "sent" as const, attempt };
        }
        httpStatus = 502;
        errorDetail = `Unexpected webhook 2xx response status: ${redactText(rawResponse.slice(0, 120)) || "empty"}`;
      } else {
        const responseSnippet = redactText((await response.text().catch(() => "")).slice(0, 160));
        errorDetail = responseSnippet
          ? `HTTP ${httpStatus}: ${responseSnippet}`
          : `HTTP ${httpStatus}`;
      }
    } catch (error) {
      httpStatus = 0;
      const message = error instanceof Error ? error.message : "Network error";
      errorDetail = `Network failure: ${redactText(message)}`;
    }

    if (shouldRetryHttpStatus(httpStatus, attempt, RETRY_DEFAULTS.maxAttempts)) {
      const delayMs = computeRetryDelayMs(attempt);
      await ctx.runMutation(internal.automation.internal.recordDeliveryOutcome, {
        activityId: args.activityId,
        status: "pending",
        attemptCount: attempt,
        lastError: errorDetail,
      });
      await ctx.scheduler.runAfter(delayMs, internal.automation.actions.deliverLoanNotification, {
        activityId: args.activityId,
        attempt: attempt + 1,
      });
      console.warn(
        formatStructuredLog({
          level: "warn",
          event: "automation.delivery.retry_scheduled",
          context: {
            activityId: args.activityId,
            attempt,
            httpStatus,
            delayMs,
          },
        }),
      );
      return { outcome: "retrying" as const, attempt };
    }

    await ctx.runMutation(internal.automation.internal.recordDeliveryOutcome, {
      activityId: args.activityId,
      status: "failed",
      attemptCount: attempt,
      lastError: errorDetail,
      completedAt: Date.now(),
    });
    console.error(
      formatStructuredLog({
        level: "error",
        event: "automation.delivery.failed",
        context: {
          activityId: args.activityId,
          attempt,
          httpStatus,
        },
      }),
    );
    return { outcome: "failed" as const, attempt };
  },
});
