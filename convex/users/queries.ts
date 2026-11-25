import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { DOMAIN_LIMITS } from "../../src/domain/types";
import { requireAdmin } from "../lib/authz";
import { userRoleValidator } from "../schema";
import { currentUserDtoValidator, toCurrentUserDto } from "./mutations";

const adminUserDtoValidator = v.object({
  _id: v.id("users"),
  displayName: v.string(),
  email: v.string(),
  role: userRoleValidator,
  trustedLender: v.boolean(),
  isDeleted: v.boolean(),
  createdAt: v.number(),
});

function toAdminUserDto(user: Doc<"users">) {
  return {
    _id: user._id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    trustedLender: user.trustedLender,
    isDeleted: user.deletedAt !== undefined,
    createdAt: user.createdAt,
  };
}

function clampPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DOMAIN_LIMITS.MAX_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit), 1), DOMAIN_LIMITS.MAX_PAGE_SIZE);
}

export const getCurrentUser = query({
  args: {},
  returns: v.union(currentUserDtoValidator, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
      .unique();

    if (!user || user.deletedAt !== undefined) {
      return null;
    }

    return toCurrentUserDto(user);
  },
});

/**
 * Admin-only paginated User directory.
 * Strictly omits external auth IDs (`externalId`) from the returned DTO.
 */
export const listUsersForAdmin = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(adminUserDtoValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const numItems = clampPageSize(args.limit);
    const pageResult = await ctx.db
      .query("users")
      .order("desc")
      .paginate({
        numItems,
        cursor: args.cursor ?? null,
      });

    return {
      items: pageResult.page.map(toAdminUserDto),
      continueCursor: pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});
