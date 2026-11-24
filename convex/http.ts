import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { formatStructuredLog } from "../src/domain/redaction";

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

export default http;
