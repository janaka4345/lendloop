import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { toUtcDateString, todayUtcDate } from "../../src/domain/dates";
import { createTestBackend, expectAppError } from "./test-helpers";

function addDaysUtc(baseDate: string, days: number): string {
  const [y, m, d] = baseDate.split("-").map(Number);
  return toUtcDateString(new Date(Date.UTC(y!, m! - 1, d! + days)));
}

async function seedUser(
  t: ReturnType<typeof createTestBackend>,
  params: {
    subject: string;
    email: string;
    name: string;
    role?: "user" | "admin";
  },
): Promise<{
  userId: Id<"users">;
  asUser: ReturnType<ReturnType<typeof createTestBackend>["withIdentity"]>;
}> {
  const asUser = t.withIdentity({
    subject: params.subject,
    email: params.email,
    name: params.name,
  });
  const synced = await asUser.mutation(api.users.mutations.syncCurrentUser, {});
  if (params.role === "admin") {
    await t.mutation(internal.users.mutations.setUserRole, {
      userId: synced._id,
      role: "admin",
    });
  }
  return { userId: synced._id, asUser };
}

describe("Admin panel — Users tab (listUsersForAdmin & setTrustedLender)", () => {
  it("lists Users with pagination, omits externalId, and rejects unauthenticated or non-Admin callers", async () => {
    const t = createTestBackend();
    const admin = await seedUser(t, {
      subject: "clerk_admin_1",
      email: "admin@example.com",
      name: "Admin Alice",
      role: "admin",
    });
    const bob = await seedUser(t, {
      subject: "clerk_bob_1",
      email: "bob@example.com",
      name: "Bob Builder",
    });
    await seedUser(t, {
      subject: "clerk_carol_1",
      email: "carol@example.com",
      name: "Carol Carpenter",
    });

    // Unauthenticated rejected
    await expectAppError(t.query(api.users.queries.listUsersForAdmin, {}), "UNAUTHENTICATED");

    // Regular User rejected
    await expectAppError(bob.asUser.query(api.users.queries.listUsersForAdmin, {}), "FORBIDDEN");

    // Admin paginated listing (limit 2 -> page 1 of 2, then page 2 of 1)
    const page1 = await admin.asUser.query(api.users.queries.listUsersForAdmin, {
      limit: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).toBeTruthy();

    const page2 = await admin.asUser.query(api.users.queries.listUsersForAdmin, {
      limit: 2,
      cursor: page1.continueCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.isDone).toBe(true);

    const allItems = [...page1.items, ...page2.items];
    expect(allItems.map((u) => u.email).sort()).toEqual([
      "admin@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);

    // Strictly omits externalId from every returned User DTO
    for (const item of allItems) {
      expect("externalId" in item).toBe(false);
      expect(Object.keys(item).sort()).toEqual([
        "_id",
        "createdAt",
        "displayName",
        "email",
        "isDeleted",
        "role",
        "trustedLender",
      ]);
    }
  });

  it("allows an Admin to toggle Trusted Lender with an atomic Audit Log entry, and blocks non-Admins or deleted Users", async () => {
    const t = createTestBackend();
    const admin = await seedUser(t, {
      subject: "clerk_admin_2",
      email: "admin2@example.com",
      name: "Admin Two",
      role: "admin",
    });
    const bob = await seedUser(t, {
      subject: "clerk_bob_2",
      email: "bob2@example.com",
      name: "Bob Two",
    });

    // Unauthenticated rejected
    await expectAppError(
      t.mutation(api.users.mutations.setTrustedLender, {
        userId: bob.userId,
        trustedLender: true,
      }),
      "UNAUTHENTICATED",
    );

    // Regular User rejected
    await expectAppError(
      bob.asUser.mutation(api.users.mutations.setTrustedLender, {
        userId: bob.userId,
        trustedLender: true,
      }),
      "FORBIDDEN",
    );

    // Admin grants Trusted Lender
    const granted = await admin.asUser.mutation(api.users.mutations.setTrustedLender, {
      userId: bob.userId,
      trustedLender: true,
    });
    expect(granted).toEqual({ _id: bob.userId, trustedLender: true });

    // Admin revokes Trusted Lender
    const revoked = await admin.asUser.mutation(api.users.mutations.setTrustedLender, {
      userId: bob.userId,
      trustedLender: false,
    });
    expect(revoked).toEqual({ _id: bob.userId, trustedLender: false });

    // Verify two atomic user.trusted_lender_toggled Audit Log entries with zero PII
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q) => q.eq("action", "user.trusted_lender_toggled"))
        .collect(),
    );
    expect(logs).toHaveLength(2);
    expect(logs[0]?.actorId).toBe(admin.userId);
    expect(logs[0]?.actorRole).toBe("admin");
    expect(logs[0]?.targetType).toBe("user");
    expect(logs[0]?.targetId).toBe(bob.userId);
    expect(logs[0]?.metadata).toEqual({
      previousTrustedLender: false,
      nextTrustedLender: true,
    });
    expect(logs[1]?.metadata).toEqual({
      previousTrustedLender: true,
      nextTrustedLender: false,
    });

    // Deleted User cannot be toggled
    await t.mutation(internal.users.mutations.handleClerkUserDeleted, {
      externalId: "clerk_bob_2",
    });
    await expectAppError(
      admin.asUser.mutation(api.users.mutations.setTrustedLender, {
        userId: bob.userId,
        trustedLender: true,
      }),
      "CONFLICT",
    );
  });
});

describe("Admin panel — Listings tab (listAllListingsForAdmin & adminRemoveListing)", () => {
  it("lists active and archived Listings for Admins only, and force-removes a Listing even with an unreturned approved Loan", async () => {
    const t = createTestBackend();
    const admin = await seedUser(t, {
      subject: "clerk_admin_3",
      email: "admin3@example.com",
      name: "Admin Three",
      role: "admin",
    });
    const lender = await seedUser(t, {
      subject: "clerk_lender_3",
      email: "lender3@example.com",
      name: "Lender Liam",
    });
    const borrowerA = await seedUser(t, {
      subject: "clerk_borrower_3a",
      email: "borrower3a@example.com",
      name: "Borrower Maya",
    });
    const borrowerB = await seedUser(t, {
      subject: "clerk_borrower_3b",
      email: "borrower3b@example.com",
      name: "Borrower Noah",
    });

    // Seed a stored WebP image and register it for the lender
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" })),
    );
    await lender.asUser.mutation(api.listings.mutations.registerListingImageUpload, {
      storageId,
      contentType: "image/webp",
      sizeBytes: 4,
      width: 800,
      height: 600,
    });

    const { _id: listingId } = await lender.asUser.mutation(api.listings.mutations.createListing, {
      name: "Cordless Hammer Drill",
      category: "power_tools",
      condition: "good",
      description: "Heavy duty hammer drill with spare battery.",
      imageIds: [storageId],
    });

    const today = todayUtcDate();
    // Approved Loan (unreturned) + open pending Loan on different dates
    const { _id: approvedLoanId } = await borrowerA.asUser.mutation(
      api.lending.mutations.requestLoan,
      {
        listingId,
        startDate: today,
        endDate: addDaysUtc(today, 2),
      },
    );
    await lender.asUser.mutation(api.lending.mutations.approveLoan, { loanId: approvedLoanId });

    const { _id: pendingLoanId } = await borrowerB.asUser.mutation(
      api.lending.mutations.requestLoan,
      {
        listingId,
        startDate: addDaysUtc(today, 5),
        endDate: addDaysUtc(today, 6),
      },
    );

    // Negative RBAC checks
    await expectAppError(
      t.query(api.listings.queries.listAllListingsForAdmin, {}),
      "UNAUTHENTICATED",
    );
    await expectAppError(
      lender.asUser.query(api.listings.queries.listAllListingsForAdmin, {}),
      "FORBIDDEN",
    );
    await expectAppError(
      t.mutation(api.listings.mutations.adminRemoveListing, {
        listingId,
        archiveReason: "Unsafe item",
      }),
      "UNAUTHENTICATED",
    );
    await expectAppError(
      lender.asUser.mutation(api.listings.mutations.adminRemoveListing, {
        listingId,
        archiveReason: "Unsafe item",
      }),
      "FORBIDDEN",
    );

    // Required archiveReason validation
    await expectAppError(
      admin.asUser.mutation(api.listings.mutations.adminRemoveListing, {
        listingId,
        archiveReason: "   ",
      }),
      "VALIDATION_ERROR",
    );

    // Admin sees active listing with counts
    const beforeRemove = await admin.asUser.query(api.listings.queries.listAllListingsForAdmin, {
      status: "active",
    });
    expect(beforeRemove.items).toHaveLength(1);
    expect(beforeRemove.items[0]?.activeApprovedLoanCount).toBe(1);
    expect(beforeRemove.items[0]?.pendingRequestCount).toBe(1);
    expect(beforeRemove.items[0]?.imageCount).toBe(1);

    // Admin removes Listing despite active approved Loan
    const result = await admin.asUser.mutation(api.listings.mutations.adminRemoveListing, {
      listingId,
      archiveReason: "Safety recall notice from manufacturer",
    });
    expect(result).toEqual({
      _id: listingId,
      autoDeclinedCount: 1,
      deletedImageCount: 1,
      activeApprovedLoanCount: 1,
    });

    // Cannot archive twice
    await expectAppError(
      admin.asUser.mutation(api.listings.mutations.adminRemoveListing, {
        listingId,
        archiveReason: "Duplicate removal",
      }),
      "CONFLICT",
    );

    // Verify image blob deleted immediately
    const imageUrlAfter = await t.run(async (ctx) => ctx.storage.getUrl(storageId));
    expect(imageUrlAfter).toBeNull();

    // Verify pending Loan auto-declined + notification enqueued, approved Loan preserved & flagged
    const pendingLoanAfter = await t.run(async (ctx) => ctx.db.get(pendingLoanId));
    expect(pendingLoanAfter?.status).toBe("declined");
    expect(pendingLoanAfter?.decisionReason).toBe("Listing removed by Admin");

    const declinedActivities = await t.run(async (ctx) =>
      ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", pendingLoanId))
        .collect(),
    );
    expect(declinedActivities.some((a) => a.eventType === "loan_declined")).toBe(true);

    const borrowerRequests = await borrowerA.asUser.query(api.lending.queries.listMyRequests, {});
    expect(borrowerRequests.active).toHaveLength(1);
    expect(borrowerRequests.active[0]?.status).toBe("approved");
    expect(borrowerRequests.active[0]?.listing.isArchived).toBe(true);

    // Admin status filters show 0 active, 1 archived
    const activeAfter = await admin.asUser.query(api.listings.queries.listAllListingsForAdmin, {
      status: "active",
    });
    expect(activeAfter.items).toHaveLength(0);

    const archivedAfter = await admin.asUser.query(api.listings.queries.listAllListingsForAdmin, {
      status: "archived",
    });
    expect(archivedAfter.items).toHaveLength(1);
    expect(archivedAfter.items[0]?.isArchived).toBe(true);
    expect(archivedAfter.items[0]?.archiveReason).toBe("Safety recall notice from manufacturer");

    // Atomic Audit Log entry written by Admin with zero PII
    const archiveLogs = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q) => q.eq("action", "listing.archived"))
        .collect(),
    );
    expect(archiveLogs).toHaveLength(1);
    expect(archiveLogs[0]?.actorId).toBe(admin.userId);
    expect(archiveLogs[0]?.actorRole).toBe("admin");
    expect(archiveLogs[0]?.targetId).toBe(listingId);
    expect(archiveLogs[0]?.metadata).toEqual({
      actorType: "admin",
      autoDeclinedCount: 1,
      deletedImageCount: 1,
      activeApprovedLoanCount: 1,
    });
  });
});

describe("Admin panel — All Loans tab (listAllLoansForAdmin)", () => {
  it("lists platform Loans filterable by status and Overdue, exposes sanitized lastError to Admins only, and blocks non-Admins", async () => {
    const t = createTestBackend();
    const admin = await seedUser(t, {
      subject: "clerk_admin_4",
      email: "admin4@example.com",
      name: "Admin Four",
      role: "admin",
    });
    const lender = await seedUser(t, {
      subject: "clerk_lender_4",
      email: "lender4@example.com",
      name: "Lender Leo",
    });
    const borrower = await seedUser(t, {
      subject: "clerk_borrower_4",
      email: "borrower4@example.com",
      name: "Borrower Bea",
    });

    const { _id: listingId } = await lender.asUser.mutation(api.listings.mutations.createListing, {
      name: "Pressure Washer",
      category: "cleaning",
      condition: "like_new",
      description: "Electric 2000 PSI pressure washer.",
    });

    const today = todayUtcDate();
    // Create a pending Loan
    const { _id: pendingLoanId } = await borrower.asUser.mutation(
      api.lending.mutations.requestLoan,
      {
        listingId,
        startDate: addDaysUtc(today, 3),
        endDate: addDaysUtc(today, 4),
      },
    );

    // Seed an Overdue approved Loan directly with a failed Automation Activity containing an email in lastError
    const overdueLoanId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("loans", {
        listingId,
        lenderId: lender.userId,
        borrowerId: borrower.userId,
        startDate: addDaysUtc(today, -5),
        endDate: addDaysUtc(today, -1),
        status: "approved",
        createdAt: now - 10_000,
        updatedAt: now - 10_000,
      });
      await ctx.db.insert("automationActivities", {
        loanId: id,
        eventType: "overdue_reminder",
        idempotencyKey: `overdue_reminder:${id}:${today}`,
        status: "failed",
        attemptCount: 3,
        recipientRole: "borrower",
        lastError: "SMTP 550 rejected for borrower4@example.com with Bearer secret_token_123",
        createdAt: now - 1_000,
        completedAt: now - 500,
      });
      return id;
    });

    // Negative RBAC checks
    await expectAppError(t.query(api.lending.queries.listAllLoansForAdmin, {}), "UNAUTHENTICATED");
    await expectAppError(
      borrower.asUser.query(api.lending.queries.listAllLoansForAdmin, {}),
      "FORBIDDEN",
    );

    // Admin fetches all loans
    const allLoans = await admin.asUser.query(api.lending.queries.listAllLoansForAdmin, {});
    expect(allLoans.items).toHaveLength(2);

    // Filter by status = pending
    const pendingOnly = await admin.asUser.query(api.lending.queries.listAllLoansForAdmin, {
      status: "pending",
    });
    expect(pendingOnly.items.map((l) => l._id)).toEqual([pendingLoanId]);

    // Filter by overdueOnly = true
    const overdueOnly = await admin.asUser.query(api.lending.queries.listAllLoansForAdmin, {
      overdueOnly: true,
    });
    expect(overdueOnly.items).toHaveLength(1);
    expect(overdueOnly.items[0]?._id).toBe(overdueLoanId);
    expect(overdueOnly.items[0]?.isOverdue).toBe(true);
    expect(overdueOnly.items[0]?.lender.displayName).toBe("Lender Leo");
    expect(overdueOnly.items[0]?.borrower.displayName).toBe("Borrower Bea");

    // Admin receives sanitized lastError (email + bearer token redacted)
    const failedActivity = overdueOnly.items[0]?.automationActivities[0];
    expect(failedActivity?.status).toBe("failed");
    expect(failedActivity?.lastError).toBeDefined();
    expect(failedActivity?.lastError).not.toContain("borrower4@example.com");
    expect(failedActivity?.lastError).not.toContain("secret_token_123");
    expect(failedActivity?.lastError).toContain("[REDACTED]");

    // Regular Borrower NEVER sees lastError
    const borrowerView = await borrower.asUser.query(api.lending.queries.getLoanById, {
      loanId: overdueLoanId,
    });
    expect(borrowerView.automationActivities[0]?.lastError).toBeUndefined();

    // Conflicting filter: overdueOnly + pending returns empty
    const impossibleFilter = await admin.asUser.query(api.lending.queries.listAllLoansForAdmin, {
      status: "pending",
      overdueOnly: true,
    });
    expect(impossibleFilter.items).toHaveLength(0);
    expect(impossibleFilter.isDone).toBe(true);
  });
});

describe("Admin panel — Audit Log tab (listAuditLogs)", () => {
  it("lists read-only paginated Audit Logs filterable by action with zero PII, and blocks non-Admins", async () => {
    const t = createTestBackend();
    const admin = await seedUser(t, {
      subject: "clerk_admin_5",
      email: "admin5@example.com",
      name: "Admin Five",
      role: "admin",
    });
    const member = await seedUser(t, {
      subject: "clerk_member_5",
      email: "member5@example.com",
      name: "Member Sam",
    });

    // Generate multiple audit log actions
    await admin.asUser.mutation(api.users.mutations.setTrustedLender, {
      userId: member.userId,
      trustedLender: true,
    });
    await member.asUser.mutation(api.listings.mutations.createListing, {
      name: "Camping Lantern",
      category: "camping",
      condition: "new",
      description: "Rechargeable LED lantern.",
    });

    // Negative RBAC checks
    await expectAppError(t.query(api.audit.queries.listAuditLogs, {}), "UNAUTHENTICATED");
    await expectAppError(member.asUser.query(api.audit.queries.listAuditLogs, {}), "FORBIDDEN");

    // Admin paginated query across all actions (setUserRole + setTrustedLender + createListing = 3)
    const page1 = await admin.asUser.query(api.audit.queries.listAuditLogs, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.isDone).toBe(false);

    const page2 = await admin.asUser.query(api.audit.queries.listAuditLogs, {
      limit: 2,
      cursor: page1.continueCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.isDone).toBe(true);

    // Filter by action
    const trustedLogs = await admin.asUser.query(api.audit.queries.listAuditLogs, {
      action: "user.trusted_lender_toggled",
    });
    expect(trustedLogs.items).toHaveLength(1);
    expect(trustedLogs.items[0]?.action).toBe("user.trusted_lender_toggled");
    expect(trustedLogs.items[0]?.actorRole).toBe("admin");

    // Verify zero PII in all audit log metadata
    for (const log of [...page1.items, ...page2.items]) {
      const serialized = JSON.stringify(log.metadata ?? {});
      expect(serialized).not.toContain("@example.com");
      expect(serialized).not.toContain("clerk_");
    }
  });
});
