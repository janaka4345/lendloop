import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { UserRole } from "../../src/domain/types";
import { createAppError } from "./errors";

export type AuthzCtx = QueryCtx | MutationCtx;

export async function requireIdentity(ctx: AuthzCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw createAppError("UNAUTHENTICATED", "Authentication is required.");
  }
  return identity;
}

export async function requireCurrentUser(ctx: AuthzCtx): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
    .unique();

  if (!user) {
    throw createAppError("UNAUTHENTICATED", "User has not been synced yet.");
  }
  if (user.deletedAt !== undefined) {
    throw createAppError("FORBIDDEN", "This User has been deleted.", {
      targetType: "user",
      targetId: user._id,
    });
  }
  return user;
}

export async function requireRole(ctx: AuthzCtx, requiredRole: UserRole): Promise<Doc<"users">> {
  const user = await requireCurrentUser(ctx);
  if (user.role !== requiredRole) {
    throw createAppError("FORBIDDEN", `This action requires the ${requiredRole} role.`, {
      actorId: user._id,
      actorRole: user.role,
      requiredRole,
    });
  }
  return user;
}

export async function requireAdmin(ctx: AuthzCtx): Promise<Doc<"users">> {
  return requireRole(ctx, "admin");
}

async function loadListingForLender(
  ctx: AuthzCtx,
  listingId: Id<"listings">,
  allowAdmin: boolean,
): Promise<{ user: Doc<"users">; listing: Doc<"listings"> }> {
  const user = await requireCurrentUser(ctx);
  const listing = await ctx.db.get(listingId);
  if (!listing) {
    throw createAppError("NOT_FOUND", "Listing not found.");
  }
  const isAuthorized = listing.lenderId === user._id || (allowAdmin && user.role === "admin");
  if (!isAuthorized) {
    throw createAppError(
      "FORBIDDEN",
      allowAdmin
        ? "Only the Listing Lender or an Admin can perform this action."
        : "Only the Lender who owns this Listing can perform this action.",
      {
        actorId: user._id,
        actorRole: user.role,
        targetType: "listing",
        targetId: listingId,
      },
    );
  }
  return { user, listing };
}

export async function requireListingLender(
  ctx: AuthzCtx,
  listingId: Id<"listings">,
): Promise<{ user: Doc<"users">; listing: Doc<"listings"> }> {
  return loadListingForLender(ctx, listingId, false);
}

export async function requireListingLenderOrAdmin(
  ctx: AuthzCtx,
  listingId: Id<"listings">,
): Promise<{ user: Doc<"users">; listing: Doc<"listings"> }> {
  return loadListingForLender(ctx, listingId, true);
}

async function loadLoanForParticipant(
  ctx: AuthzCtx,
  loanId: Id<"loans">,
  allowAdmin: boolean,
): Promise<{
  user: Doc<"users">;
  loan: Doc<"loans">;
  participantRole: "lender" | "borrower" | "admin";
}> {
  const user = await requireCurrentUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) {
    throw createAppError("NOT_FOUND", "Loan not found.");
  }
  if (loan.lenderId === user._id) {
    return { user, loan, participantRole: "lender" };
  }
  if (loan.borrowerId === user._id) {
    return { user, loan, participantRole: "borrower" };
  }
  if (allowAdmin && user.role === "admin") {
    return { user, loan, participantRole: "admin" };
  }
  throw createAppError(
    "FORBIDDEN",
    allowAdmin
      ? "Only participants on this Loan or an Admin can access it."
      : "Only participants on this Loan can access it.",
    {
      actorId: user._id,
      actorRole: user.role,
      targetType: "loan",
      targetId: loanId,
    },
  );
}

export async function requireLoanParticipant(
  ctx: AuthzCtx,
  loanId: Id<"loans">,
): Promise<{ user: Doc<"users">; loan: Doc<"loans">; participantRole: "lender" | "borrower" }> {
  const result = await loadLoanForParticipant(ctx, loanId, false);
  return result as {
    user: Doc<"users">;
    loan: Doc<"loans">;
    participantRole: "lender" | "borrower";
  };
}

export async function requireLoanParticipantOrAdmin(
  ctx: AuthzCtx,
  loanId: Id<"loans">,
): Promise<{
  user: Doc<"users">;
  loan: Doc<"loans">;
  participantRole: "lender" | "borrower" | "admin";
}> {
  return loadLoanForParticipant(ctx, loanId, true);
}
