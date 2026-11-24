import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { createAppError } from "./errors";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  syncCurrentUser: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  listingWrite: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 10 },
  listingImageUpload: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  loanWrite: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 15 },
  adminWrite: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 20 },
});

export type RateLimitName =
  "syncCurrentUser" | "listingWrite" | "listingImageUpload" | "loanWrite" | "adminWrite";

export async function enforceRateLimit(
  ctx: MutationCtx,
  name: RateLimitName,
  key: string,
): Promise<void> {
  const status = await rateLimiter.limit(ctx, name, { key });
  if (!status.ok) {
    throw createAppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
      limitName: name,
    });
  }
}
