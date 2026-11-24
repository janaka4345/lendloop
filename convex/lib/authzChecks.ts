import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import {
  requireAdmin,
  requireCurrentUser,
  requireListingLender,
  requireListingLenderOrAdmin,
  requireLoanParticipant,
  requireLoanParticipantOrAdmin,
} from "./authz";

export const verifyCurrentUser = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return user._id;
  },
});

export const verifyAdmin = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    return admin._id;
  },
});

export const verifyListingLender = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.id("listings"),
  handler: async (ctx, args) => {
    const { listing } = await requireListingLender(ctx, args.listingId);
    return listing._id;
  },
});

export const verifyListingLenderOrAdmin = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.id("listings"),
  handler: async (ctx, args) => {
    const { listing } = await requireListingLenderOrAdmin(ctx, args.listingId);
    return listing._id;
  },
});

export const verifyLoanParticipant = internalQuery({
  args: { loanId: v.id("loans") },
  returns: v.union(v.literal("lender"), v.literal("borrower")),
  handler: async (ctx, args) => {
    const { participantRole } = await requireLoanParticipant(ctx, args.loanId);
    return participantRole;
  },
});

export const verifyLoanParticipantOrAdmin = internalQuery({
  args: { loanId: v.id("loans") },
  returns: v.union(v.literal("lender"), v.literal("borrower"), v.literal("admin")),
  handler: async (ctx, args) => {
    const { participantRole } = await requireLoanParticipantOrAdmin(ctx, args.loanId);
    return participantRole;
  },
});
