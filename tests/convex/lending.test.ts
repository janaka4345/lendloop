import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { todayUtcDate } from "../../src/domain/dates";
import { createTestBackend, expectAppError } from "./test-helpers";

function shiftUtcDays(baseUtc: string, days: number): string {
  const [year, month, day] = baseUtc.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000);
  return todayUtcDate(date);
}

async function seedUsersAndListing(t: ReturnType<typeof createTestBackend>) {
  const lenderAuth = t.withIdentity({
    subject: "clerk_lender_1",
    email: "lender@example.com",
    name: "Lender Alice",
  });
  const borrowerAuth = t.withIdentity({
    subject: "clerk_borrower_1",
    email: "borrower@example.com",
    name: "Borrower Bob",
  });
  const borrower2Auth = t.withIdentity({
    subject: "clerk_borrower_2",
    email: "borrower2@example.com",
    name: "Borrower Carol",
  });
  const outsiderAuth = t.withIdentity({
    subject: "clerk_outsider_1",
    email: "outsider@example.com",
    name: "Outsider Dave",
  });
  const adminAuth = t.withIdentity({
    subject: "clerk_admin_1",
    email: "admin@example.com",
    name: "Admin Eve",
  });

  const lender = await lenderAuth.mutation(api.users.mutations.syncCurrentUser, {});
  const borrower = await borrowerAuth.mutation(api.users.mutations.syncCurrentUser, {});
  const borrower2 = await borrower2Auth.mutation(api.users.mutations.syncCurrentUser, {});
  const outsider = await outsiderAuth.mutation(api.users.mutations.syncCurrentUser, {});
  const admin = await adminAuth.mutation(api.users.mutations.syncCurrentUser, {});

  await t.run(async (ctx) => {
    await ctx.db.patch(lender._id, { trustedLender: true });
    await ctx.db.patch(admin._id, { role: "admin" });
  });

  const { _id: listingId } = await lenderAuth.mutation(api.listings.mutations.createListing, {
    name: "DeWalt Cordless Drill",
    category: "power_tools",
    condition: "like_new",
    description: "20V MAX drill with two batteries and charger.",
  });

  return {
    lenderAuth,
    borrowerAuth,
    borrower2Auth,
    outsiderAuth,
    adminAuth,
    lender,
    borrower,
    borrower2,
    outsider,
    admin,
    listingId,
  };
}

describe("Lending lifecycle, conflict auto-decline, DTO privacy & RBAC", () => {
  it("submits a valid Loan request, enforces date/overlap/self-borrow rules, and writes Audit Log + Automation Activity", async () => {
    const t = createTestBackend();
    const { lenderAuth, borrowerAuth, listingId } = await seedUsersAndListing(t);
    const today = todayUtcDate();
    const start = shiftUtcDays(today, 2);
    const end = shiftUtcDays(today, 4);

    // Unauthenticated rejected
    await expectAppError(
      t.mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: start,
        endDate: end,
      }),
      "UNAUTHENTICATED",
    );

    // Self-borrowing rejected
    await expectAppError(
      lenderAuth.mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: start,
        endDate: end,
      }),
      "FORBIDDEN",
    );

    // Past start date rejected
    await expectAppError(
      borrowerAuth.mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: shiftUtcDays(today, -1),
        endDate: today,
      }),
      "VALIDATION_ERROR",
    );

    // >30 days rejected
    await expectAppError(
      borrowerAuth.mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: today,
        endDate: shiftUtcDays(today, 30),
      }),
      "VALIDATION_ERROR",
    );

    // Valid request succeeds
    const { _id: loanId } = await borrowerAuth.mutation(api.lending.mutations.requestLoan, {
      listingId,
      startDate: start,
      endDate: end,
      note: "  Building a bookshelf  ",
    });

    const { loan, audits, activities } = await t.run(async (ctx) => {
      const loanDoc = await ctx.db.get(loanId);
      const auditDocs = await ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) => q.eq("targetType", "loan").eq("targetId", loanId))
        .collect();
      const activityDocs = await ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", loanId))
        .collect();
      return { loan: loanDoc, audits: auditDocs, activities: activityDocs };
    });

    expect(loan?.status).toBe("pending");
    expect(loan?.note).toBe("Building a bookshelf");
    expect(audits.map((a) => a.action)).toEqual(["loan.requested"]);
    expect(activities).toHaveLength(1);
    expect(activities[0]?.eventType).toBe("loan_requested");
    expect(activities[0]?.status).toBe("pending");
    expect(activities[0]?.recipientRole).toBe("lender");

    // Incoming pending count reflects the request for the Lender
    const pendingBadge = await lenderAuth.query(api.lending.queries.getIncomingPendingCount, {});
    expect(pendingBadge.count).toBe(1);
  });

  it("atomically auto-declines overlapping pending Loans on approve, preserves non-overlapping pending Loans, and blocks overlapping new requests", async () => {
    const t = createTestBackend();
    const { lenderAuth, borrowerAuth, borrower2Auth, listingId } = await seedUsersAndListing(t);
    const today = todayUtcDate();

    // Loan A: days 3..6
    const { _id: loanA } = await borrowerAuth.mutation(api.lending.mutations.requestLoan, {
      listingId,
      startDate: shiftUtcDays(today, 3),
      endDate: shiftUtcDays(today, 6),
    });

    // Loan B (overlapping): days 5..8
    const { _id: loanB } = await borrower2Auth.mutation(api.lending.mutations.requestLoan, {
      listingId,
      startDate: shiftUtcDays(today, 5),
      endDate: shiftUtcDays(today, 8),
    });

    // Loan C (non-overlapping): days 10..12
    const { _id: loanC } = await borrower2Auth.mutation(api.lending.mutations.requestLoan, {
      listingId,
      startDate: shiftUtcDays(today, 10),
      endDate: shiftUtcDays(today, 12),
    });

    // Incoming requests reports conflictingPendingCount = 1 for Loan A
    const incomingBefore = await lenderAuth.query(api.lending.queries.listIncomingRequests, {});
    const loanADto = incomingBefore.active.find((l) => l._id === loanA);
    const loanCDto = incomingBefore.active.find((l) => l._id === loanC);
    expect(loanADto?.conflictingPendingCount).toBe(1);
    expect(loanCDto?.conflictingPendingCount).toBe(0);

    // Borrower cannot approve their own Loan
    await expectAppError(
      borrowerAuth.mutation(api.lending.mutations.approveLoan, { loanId: loanA }),
      "FORBIDDEN",
    );

    // Lender approves Loan A
    const approval = await lenderAuth.mutation(api.lending.mutations.approveLoan, {
      loanId: loanA,
    });
    expect(approval.autoDeclinedCount).toBe(1);

    const state = await t.run(async (ctx) => ({
      a: await ctx.db.get(loanA),
      b: await ctx.db.get(loanB),
      c: await ctx.db.get(loanC),
      bActivities: await ctx.db
        .query("automationActivities")
        .withIndex("by_loan_created", (q) => q.eq("loanId", loanB))
        .collect(),
      bAudits: await ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) => q.eq("targetType", "loan").eq("targetId", loanB))
        .collect(),
    }));

    expect(state.a?.status).toBe("approved");
    expect(state.b?.status).toBe("declined");
    expect(state.b?.decisionReason).toBe("Dates no longer available");
    expect(state.c?.status).toBe("pending");
    expect(
      state.bActivities.some((a) => a.eventType === "loan_declined" && a.status === "pending"),
    ).toBe(true);
    expect(
      state.bAudits.some((a) => a.action === "loan.declined" && a.actorRole === "system"),
    ).toBe(true);

    // New request overlapping approved Loan A is rejected with CONFLICT
    await expectAppError(
      borrower2Auth.mutation(api.lending.mutations.requestLoan, {
        listingId,
        startDate: shiftUtcDays(today, 6),
        endDate: shiftUtcDays(today, 9),
      }),
      "CONFLICT",
    );

    // Approving a pending Loan that overlaps an existing approved Loan is rejected with CONFLICT
    const conflictingPendingId = await t.run(async (ctx) => {
      const loanADoc = await ctx.db.get(loanA);
      return ctx.db.insert("loans", {
        listingId,
        lenderId: loanADoc!.lenderId,
        borrowerId: loanADoc!.borrowerId,
        startDate: shiftUtcDays(today, 4),
        endDate: shiftUtcDays(today, 7),
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await expectAppError(
      lenderAuth.mutation(api.lending.mutations.approveLoan, { loanId: conflictingPendingId }),
      "CONFLICT",
    );
  });

  it("enforces decline, pre-startDate cancellation boundary, and return on archived Listing", async () => {
    const t = createTestBackend();
    const { lenderAuth, borrowerAuth, outsiderAuth, adminAuth, listingId } =
      await seedUsersAndListing(t);
    const today = todayUtcDate();

    // 1. Decline pending Loan with reason
    const { _id: pendingToDecline } = await borrowerAuth.mutation(
      api.lending.mutations.requestLoan,
      {
        listingId,
        startDate: shiftUtcDays(today, 1),
        endDate: shiftUtcDays(today, 2),
      },
    );
    await expectAppError(
      lenderAuth.mutation(api.lending.mutations.cancelLoan, { loanId: pendingToDecline }),
      "FORBIDDEN",
    );
    await lenderAuth.mutation(api.lending.mutations.declineLoan, {
      loanId: pendingToDecline,
      decisionReason: "Using it myself this week",
    });

    // 2. Borrower cancels pending Loan
    const { _id: pendingToCancel } = await borrowerAuth.mutation(
      api.lending.mutations.requestLoan,
      {
        listingId,
        startDate: shiftUtcDays(today, 1),
        endDate: shiftUtcDays(today, 2),
      },
    );
    await expectAppError(
      outsiderAuth.mutation(api.lending.mutations.cancelLoan, { loanId: pendingToCancel }),
      "FORBIDDEN",
    );
    await borrowerAuth.mutation(api.lending.mutations.cancelLoan, { loanId: pendingToCancel });

    // 3. Approved Loan strictly before startDate CAN be cancelled by Lender or Borrower
    const { _id: futureApproved } = await borrowerAuth.mutation(api.lending.mutations.requestLoan, {
      listingId,
      startDate: shiftUtcDays(today, 4),
      endDate: shiftUtcDays(today, 5),
    });
    await lenderAuth.mutation(api.lending.mutations.approveLoan, { loanId: futureApproved });
    await lenderAuth.mutation(api.lending.mutations.cancelLoan, { loanId: futureApproved });

    // 4. Approved Loan starting today CANNOT be cancelled by either party
    const { _id: activeTodayLoan } = await borrowerAuth.mutation(
      api.lending.mutations.requestLoan,
      {
        listingId,
        startDate: today,
        endDate: shiftUtcDays(today, 2),
      },
    );
    await lenderAuth.mutation(api.lending.mutations.approveLoan, { loanId: activeTodayLoan });

    await expectAppError(
      borrowerAuth.mutation(api.lending.mutations.cancelLoan, { loanId: activeTodayLoan }),
      "CONFLICT",
    );
    await expectAppError(
      lenderAuth.mutation(api.lending.mutations.cancelLoan, { loanId: activeTodayLoan }),
      "CONFLICT",
    );

    // 5. Simulate Admin removing the Listing while activeTodayLoan is still approved & overdue
    await t.run(async (ctx) => {
      await ctx.db.patch(listingId, {
        archivedAt: Date.now(),
        archiveReason: "Safety recall",
      });
      await ctx.db.patch(activeTodayLoan, {
        startDate: shiftUtcDays(today, -3),
        endDate: shiftUtcDays(today, -1),
      });
    });

    // Unrelated outsider gets NOT_FOUND on archived Listing detail; participant & Admin can view read-only
    await expectAppError(
      outsiderAuth.query(api.listings.queries.getListingDetail, { listingId }),
      "NOT_FOUND",
    );
    const participantView = await borrowerAuth.query(api.listings.queries.getListingDetail, {
      listingId,
    });
    expect(participantView.isArchived).toBe(true);
    const adminView = await adminAuth.query(api.listings.queries.getListingDetail, { listingId });
    expect(adminView.isArchived).toBe(true);

    // Overdue loan appears in `overdue` section on My Requests & Incoming Requests
    const myReqs = await borrowerAuth.query(api.lending.queries.listMyRequests, {});
    expect(myReqs.overdue).toHaveLength(1);
    expect(myReqs.overdue[0]?._id).toBe(activeTodayLoan);
    expect(myReqs.overdue[0]?.listing.isArchived).toBe(true);

    // Borrower cannot mark returned
    await expectAppError(
      borrowerAuth.mutation(api.lending.mutations.markLoanReturned, { loanId: activeTodayLoan }),
      "FORBIDDEN",
    );

    // Lender CAN mark returned even though Listing is archived & Overdue
    const returned = await lenderAuth.mutation(api.lending.mutations.markLoanReturned, {
      loanId: activeTodayLoan,
    });
    expect(returned.returnedAt).toBeGreaterThan(0);

    const incomingAfter = await lenderAuth.query(api.lending.queries.listIncomingRequests, {});
    expect(incomingAfter.overdue).toHaveLength(0);
    expect(
      incomingAfter.history.some((l) => l._id === activeTodayLoan && l.status === "returned"),
    ).toBe(true);
  });

  it("enforces strict DTO privacy: zero counterparty email/externalId, zero borrower identity in Listing detail, and omits lastError for non-Admins", async () => {
    const t = createTestBackend();
    const { lenderAuth, borrowerAuth, outsiderAuth, adminAuth, listingId } =
      await seedUsersAndListing(t);
    const today = todayUtcDate();

    const { _id: loanId } = await borrowerAuth.mutation(api.lending.mutations.requestLoan, {
      listingId,
      startDate: shiftUtcDays(today, 2),
      endDate: shiftUtcDays(today, 5),
    });
    await lenderAuth.mutation(api.lending.mutations.approveLoan, { loanId });

    // Inject a failed Automation Activity with internal lastError
    await t.run(async (ctx) => {
      await ctx.db.insert("automationActivities", {
        loanId,
        eventType: "loan_approved",
        idempotencyKey: `failed-test:${loanId}`,
        status: "failed",
        attemptCount: 3,
        recipientRole: "borrower",
        lastError: "SMTP 535 auth failed internal secret detail",
        createdAt: Date.now() + 1000,
        completedAt: Date.now() + 1000,
      });
    });

    // Listing detail bookedRanges exposes dates only — no borrowerId or identity
    const detail = await outsiderAuth.query(api.listings.queries.getListingDetail, { listingId });
    expect(detail.bookedRanges).toEqual([
      { startDate: shiftUtcDays(today, 2), endDate: shiftUtcDays(today, 5) },
    ]);
    expect(Object.keys(detail.bookedRanges[0]!).sort()).toEqual(["endDate", "startDate"]);
    expect(detail.lender).toEqual({
      id: detail.lender.id,
      displayName: "Lender Alice",
      trustedLender: true,
    });
    expect("email" in detail.lender).toBe(false);
    expect("externalId" in detail.lender).toBe(false);

    // Borrower DTO omits counterparty email/externalId and omits lastError
    const myRequests = await borrowerAuth.query(api.lending.queries.listMyRequests, {});
    const loanCard = myRequests.active[0]!;
    expect("email" in loanCard.counterparty).toBe(false);
    expect("externalId" in loanCard.counterparty).toBe(false);
    expect("role" in loanCard.counterparty).toBe(false);
    const failedEventForUser = loanCard.automationActivities.find((e) => e.status === "failed");
    expect(failedEventForUser).toBeDefined();
    expect(failedEventForUser?.lastError).toBeUndefined();

    // Admin viewing the same Loan via getLoanById DOES see lastError
    const adminLoan = await adminAuth.query(api.lending.queries.getLoanById, { loanId });
    const failedEventForAdmin = adminLoan.automationActivities.find((e) => e.status === "failed");
    expect(failedEventForAdmin?.lastError).toBe("SMTP 535 auth failed internal secret detail");

    // Outsider cannot read the Loan
    await expectAppError(
      outsiderAuth.query(api.lending.queries.getLoanById, { loanId }),
      "FORBIDDEN",
    );
  });
});
