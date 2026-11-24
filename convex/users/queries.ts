import { v } from "convex/values";
import { query } from "../_generated/server";
import { currentUserDtoValidator, toCurrentUserDto } from "./mutations";

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
