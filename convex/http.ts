import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { formatStructuredLog } from "../src/domain/redaction";
import { verifyServiceToken } from "./automation/crypto";

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserPayload {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserPayload;
}

function extractPrimaryEmail(data: ClerkUserPayload): string {
  const addresses = data.email_addresses ?? [];
  if (data.primary_email_address_id) {
    const primary = addresses.find((a) => a.id === data.primary_email_address_id);
    if (primary?.email_address) {
      return primary.email_address.trim().toLowerCase();
    }
  }
  return (addresses[0]?.email_address ?? "").trim().toLowerCase();
}

function extractDisplayName(data: ClerkUserPayload): string {
  const fullName = [data.first_name, data.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  if (fullName) return fullName;
  if (data.username && data.username.trim().length > 0) return data.username.trim();
  return "";
}

const http = httpRouter();

http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(
        formatStructuredLog({
          level: "error",
          event: "webhook.clerk.misconfigured",
          code: "MISSING_WEBHOOK_SECRET",
        }),
      );
      return new Response(JSON.stringify({ error: "Webhook secret is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response(JSON.stringify({ error: "Missing Svix signature headers" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rawBody = await request.text();
    let event: ClerkWebhookEvent;
    try {
      const verifier = new Webhook(webhookSecret);
      verifier.verify(rawBody, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
      event = JSON.parse(rawBody) as ClerkWebhookEvent;
    } catch {
      console.warn(
        formatStructuredLog({
          level: "warn",
          event: "webhook.clerk.invalid_signature",
          code: "INVALID_SIGNATURE",
        }),
      );
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.type === "user.updated") {
      await ctx.runMutation(internal.users.mutations.handleClerkUserUpdated, {
        externalId: event.data.id,
        email: extractPrimaryEmail(event.data),
        displayName: extractDisplayName(event.data),
      });
    } else if (event.type === "user.deleted") {
      await ctx.runMutation(internal.users.mutations.handleClerkUserDeleted, {
        externalId: event.data.id,
      });
    }

    return new Response(JSON.stringify({ received: true, type: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function authenticateN8nRequest(
  request: Request,
  endpoint: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const currentToken = (process.env.N8N_SERVICE_TOKEN ?? "").trim();
  const previousToken = (process.env.N8N_SERVICE_TOKEN_PREVIOUS ?? "").trim();

  if (!currentToken && !previousToken) {
    console.error(
      formatStructuredLog({
        level: "error",
        event: "n8n.http.misconfigured",
        code: "MISSING_SERVICE_TOKEN",
        context: { endpoint },
      }),
    );
    return {
      ok: false,
      response: jsonResponse({ error: "n8n service token is not configured" }, 500),
    };
  }

  const providedToken = request.headers.get("X-N8N-Service-Token");
  const verification = await verifyServiceToken(providedToken, currentToken, previousToken);
  if (!verification.valid) {
    console.warn(
      formatStructuredLog({
        level: "warn",
        event: "n8n.http.unauthorized",
        code: "INVALID_SERVICE_TOKEN",
        context: { endpoint },
      }),
    );
    return {
      ok: false,
      response: jsonResponse({ error: "Unauthorized" }, 401),
    };
  }

  if (verification.usedPrevious) {
    console.info(
      formatStructuredLog({
        level: "info",
        event: "n8n.http.previous_token_used",
        context: { endpoint },
      }),
    );
  }

  return { ok: true };
}

http.route({
  path: "/api/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateN8nRequest(request, "/api/n8n/overdue-loans");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor && rawCursor.trim().length > 0 ? rawCursor.trim() : null;

    const rawLimit = url.searchParams.get("limit");
    let limit = 100;
    if (rawLimit !== null && rawLimit.trim().length > 0) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return jsonResponse({ error: "Invalid limit parameter" }, 400);
      }
      limit = Math.min(100, Math.floor(parsed));
    }

    const batch = await ctx.runQuery(internal.automation.internal.listOverdueLoansBatch, {
      cursor,
      limit,
    });

    return jsonResponse(batch, 200);
  }),
});

interface OverdueReminderAckPayload {
  loanId?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  error?: unknown;
}

http.route({
  path: "/api/n8n/overdue-reminders/ack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateN8nRequest(request, "/api/n8n/overdue-reminders/ack");
    if (!auth.ok) return auth.response;

    const idempotencyKey = (request.headers.get("X-Idempotency-Key") ?? "").trim();
    if (!idempotencyKey) {
      return jsonResponse({ error: "Missing X-Idempotency-Key header" }, 400);
    }

    let payload: OverdueReminderAckPayload;
    try {
      payload = (await request.json()) as OverdueReminderAckPayload;
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.loanId !== "string" ||
      payload.loanId.trim().length === 0 ||
      (payload.status !== "sent" && payload.status !== "failed")
    ) {
      return jsonResponse({ error: "Invalid acknowledgement payload" }, 400);
    }

    const attemptCount =
      typeof payload.attemptCount === "number" && Number.isFinite(payload.attemptCount)
        ? Math.max(1, Math.floor(payload.attemptCount))
        : 1;
    const lastError = typeof payload.error === "string" ? payload.error : undefined;

    let result;
    try {
      result = await ctx.runMutation(internal.automation.internal.ackOverdueReminder, {
        loanId: payload.loanId.trim() as Id<"loans">,
        idempotencyKey,
        status: payload.status,
        attemptCount,
        ...(lastError !== undefined ? { lastError } : {}),
      });
    } catch {
      return jsonResponse({ error: "Invalid loanId" }, 400);
    }

    if (!result.found) {
      return jsonResponse({ error: "Loan not found" }, 404);
    }

    return jsonResponse(
      {
        acknowledged: true,
        duplicate: result.duplicate,
        activityId: result.activityId,
        status: result.status,
      },
      200,
    );
  }),
});

export default http;
