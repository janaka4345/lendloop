import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { REDACTED } from "../../src/domain/redaction";
import { createTestBackend, expectAppError } from "./test-helpers";

const ORIGINAL_APP_ENV = process.env.APP_ENV;
const ORIGINAL_BOOTSTRAP_ADMINS = process.env.BOOTSTRAP_ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) {
    delete process.env.APP_ENV;
  } else {
    process.env.APP_ENV = ORIGINAL_APP_ENV;
  }
  if (ORIGINAL_BOOTSTRAP_ADMINS === undefined) {
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;
  } else {
    process.env.BOOTSTRAP_ADMIN_EMAILS = ORIGINAL_BOOTSTRAP_ADMINS;
  }
});

describe("User sync, JWT-only identity, bootstrap admin, and rate limiting", () => {
  it("rejects unauthenticated syncCurrentUser with UNAUTHENTICATED", async () => {
    const t = createTestBackend();
    await expectAppError(t.mutation(api.users.mutations.syncCurrentUser, {}), "UNAUTHENTICATED");
  });

  it("syncs a newly signed-in User idempotently from verified JWT and omits externalId from DTO", async () => {
    const t = createTestBackend();
    const asAlice = t.withIdentity({
      subject: "user_alice_1",
      email: "Alice@Example.com",
      name: "Alice Neighbor",
    });

    const first = await asAlice.mutation(api.users.mutations.syncCurrentUser, {});
    expect(first).toMatchObject({
      displayName: "Alice Neighbor",
      email: "alice@example.com",
      role: "user",
      trustedLender: false,
    });
    expect("externalId" in first).toBe(false);

    // Elevate role & trustedLender via server DB, then re-sync with updated JWT name
    await t.run(async (ctx) => {
      await ctx.db.patch(first._id, { role: "admin", trustedLender: true });
    });

    const asAliceRenamed = t.withIdentity({
      subject: "user_alice_1",
      email: "alice.new@example.com",
      name: "Alice Updated",
    });
    const second = await asAliceRenamed.mutation(api.users.mutations.syncCurrentUser, {});
    expect(second._id).toBe(first._id);
    expect(second.displayName).toBe("Alice Updated");
    expect(second.email).toBe("alice.new@example.com");
    expect(second.role).toBe("admin");
    expect(second.trustedLender).toBe(true);

    const fetched = await asAliceRenamed.query(api.users.queries.getCurrentUser, {});
    expect(fetched).toEqual(second);

    // Re-syncing with omitted name/email claims must preserve stored displayName and email
    const asAliceMinimalClaims = t.withIdentity({ subject: "user_alice_1" });
    const third = await asAliceMinimalClaims.mutation(api.users.mutations.syncCurrentUser, {});
    expect(third.displayName).toBe("Alice Updated");
    expect(third.email).toBe("alice.new@example.com");
  });

  it("rejects spoofed client-supplied identity or role arguments on syncCurrentUser", async () => {
    const t = createTestBackend();
    const asAttacker = t.withIdentity({
      subject: "user_attacker",
      email: "attacker@example.com",
      name: "Attacker",
    });

    await expect(
      asAttacker.mutation(api.users.mutations.syncCurrentUser, {
        role: "admin",
        externalId: "user_victim",
      } as unknown as Record<string, never>),
    ).rejects.toThrow();
  });

  it("applies BOOTSTRAP_ADMIN_EMAILS only on initial creation in non-prod environments", async () => {
    process.env.APP_ENV = "local";
    process.env.BOOTSTRAP_ADMIN_EMAILS = "boss@example.com, other@example.com";

    const t = createTestBackend();
    const asBoss = t.withIdentity({
      subject: "user_boss",
      email: "Boss@Example.com",
      name: "Boss",
    });
    const boss = await asBoss.mutation(api.users.mutations.syncCurrentUser, {});
    expect(boss.role).toBe("admin");

    // In prod, BOOTSTRAP_ADMIN_EMAILS must be ignored even on initial creation
    process.env.APP_ENV = "prod";
    const asOther = t.withIdentity({
      subject: "user_other",
      email: "other@example.com",
      name: "Other",
    });
    const other = await asOther.mutation(api.users.mutations.syncCurrentUser, {});
    expect(other.role).toBe("user");
  });

  it("enforces rate limiting on write mutations", async () => {
    const t = createTestBackend();
    const asSpammer = t.withIdentity({
      subject: "user_spammer",
      email: "spammer@example.com",
      name: "Spammer",
    });

    // Capacity is 10 per minute
    for (let i = 0; i < 10; i += 1) {
      await asSpammer.mutation(api.users.mutations.syncCurrentUser, {});
    }

    await expectAppError(
      asSpammer.mutation(api.users.mutations.syncCurrentUser, {}),
      "RATE_LIMITED",
    );
  });
});

describe("Internal role promotion, atomic non-PII Audit Log, and negative-case RBAC matrix", () => {
  it("promotes role exclusively via internalMutation and records a non-PII Audit Log atomically", async () => {
    const t = createTestBackend();
    const asUser = t.withIdentity({
      subject: "user_promo",
      email: "promo@example.com",
      name: "Promo User",
    });
    const user = await asUser.mutation(api.users.mutations.syncCurrentUser, {});
    expect(user.role).toBe("user");

    const updated = await t.mutation(internal.users.mutations.setUserRole, {
      userId: user._id,
      role: "admin",
      reason: "Approved by ops@example.com",
    });
    expect(updated).toEqual({ _id: user._id, role: "admin" });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", user._id))
        .take(10),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorRole: "system",
      action: "user.role_changed",
      targetType: "user",
      targetId: user._id,
      metadata: {
        previousRole: "user",
        nextRole: "admin",
        reason: `Approved by ${REDACTED}`,
      },
    });
  });

  it("enforces central RBAC guards across unauthenticated, wrong Lender, non-Admin, and non-participant callers", async () => {
    const t = createTestBackend();

    const asLender = t.withIdentity({
      subject: "user_lender",
      email: "lender@example.com",
      name: "Lender",
    });
    const asBorrower = t.withIdentity({
      subject: "user_borrower",
      email: "borrower@example.com",
      name: "Borrower",
    });
    const asOutsider = t.withIdentity({
      subject: "user_outsider",
      email: "outsider@example.com",
      name: "Outsider",
    });
    const asAdmin = t.withIdentity({
      subject: "user_admin",
      email: "admin@example.com",
      name: "Admin",
    });

    const lender = await asLender.mutation(api.users.mutations.syncCurrentUser, {});
    const borrower = await asBorrower.mutation(api.users.mutations.syncCurrentUser, {});
    const outsider = await asOutsider.mutation(api.users.mutations.syncCurrentUser, {});
    const admin = await asAdmin.mutation(api.users.mutations.syncCurrentUser, {});
    await t.mutation(internal.users.mutations.setUserRole, {
      userId: admin._id,
      role: "admin",
    });

    const { listingId, loanId } = await t.run(async (ctx) => {
      const now = Date.now();
      const createdListingId = await ctx.db.insert("listings", {
        lenderId: lender._id,
        name: "Cordless Drill",
        category: "power_tools",
        condition: "good",
        description: "18V cordless drill",
        createdAt: now,
        updatedAt: now,
      });
      const createdLoanId = await ctx.db.insert("loans", {
        listingId: createdListingId,
        lenderId: lender._id,
        borrowerId: borrower._id,
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { listingId: createdListingId, loanId: createdLoanId };
    });

    // 1. Unauthenticated callers
    await expectAppError(
      t.query(internal.lib.authzChecks.verifyCurrentUser, {}),
      "UNAUTHENTICATED",
    );
    await expectAppError(t.query(internal.lib.authzChecks.verifyAdmin, {}), "UNAUTHENTICATED");
    await expectAppError(
      t.query(internal.lib.authzChecks.verifyListingLender, { listingId }),
      "UNAUTHENTICATED",
    );
    await expectAppError(
      t.query(internal.lib.authzChecks.verifyLoanParticipant, { loanId }),
      "UNAUTHENTICATED",
    );

    // 2. Non-Admin rejected, Admin allowed
    await expectAppError(asLender.query(internal.lib.authzChecks.verifyAdmin, {}), "FORBIDDEN");
    expect(await asAdmin.query(internal.lib.authzChecks.verifyAdmin, {})).toBe(admin._id);

    // 3. Listing ownership (Lender-only vs Lender-or-Admin)
    expect(await asLender.query(internal.lib.authzChecks.verifyListingLender, { listingId })).toBe(
      listingId,
    );
    await expectAppError(
      asOutsider.query(internal.lib.authzChecks.verifyListingLender, { listingId }),
      "FORBIDDEN",
    );
    await expectAppError(
      asAdmin.query(internal.lib.authzChecks.verifyListingLender, { listingId }),
      "FORBIDDEN",
    );
    expect(
      await asAdmin.query(internal.lib.authzChecks.verifyListingLenderOrAdmin, { listingId }),
    ).toBe(listingId);
    await expectAppError(
      asOutsider.query(internal.lib.authzChecks.verifyListingLenderOrAdmin, { listingId }),
      "FORBIDDEN",
    );

    // 4. Loan participation (Lender, Borrower, Admin vs Outsider)
    expect(await asLender.query(internal.lib.authzChecks.verifyLoanParticipant, { loanId })).toBe(
      "lender",
    );
    expect(await asBorrower.query(internal.lib.authzChecks.verifyLoanParticipant, { loanId })).toBe(
      "borrower",
    );
    await expectAppError(
      asOutsider.query(internal.lib.authzChecks.verifyLoanParticipant, { loanId }),
      "FORBIDDEN",
    );
    await expectAppError(
      asAdmin.query(internal.lib.authzChecks.verifyLoanParticipant, { loanId }),
      "FORBIDDEN",
    );
    expect(
      await asAdmin.query(internal.lib.authzChecks.verifyLoanParticipantOrAdmin, { loanId }),
    ).toBe("admin");
    await expectAppError(
      asOutsider.query(internal.lib.authzChecks.verifyLoanParticipantOrAdmin, { loanId }),
      "FORBIDDEN",
    );

    // 5. Deleted user rejected with FORBIDDEN
    await t.run(async (ctx) => {
      await ctx.db.patch(outsider._id, { deletedAt: Date.now() });
    });
    await expectAppError(
      asOutsider.query(internal.lib.authzChecks.verifyCurrentUser, {}),
      "FORBIDDEN",
    );
    await expectAppError(asOutsider.mutation(api.users.mutations.syncCurrentUser, {}), "FORBIDDEN");
  });
});
