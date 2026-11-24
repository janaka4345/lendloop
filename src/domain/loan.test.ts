import { describe, expect, it } from "vitest";
import {
  canTransitionLoan,
  deriveListingAvailability,
  findOverlappingLoans,
  isLoanOverdue,
} from "./loan";

describe("Loan 5-status state machine and derived Availability / Overdue rules", () => {
  it("allows valid pending transitions for authorized actors only", () => {
    expect(
      canTransitionLoan({
        from: "pending",
        to: "approved",
        actor: "lender",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10",
      }),
    ).toEqual({ ok: true });

    expect(
      canTransitionLoan({
        from: "pending",
        to: "approved",
        actor: "borrower",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10",
      }).ok,
    ).toBe(false);

    expect(
      canTransitionLoan({
        from: "pending",
        to: "declined",
        actor: "lender",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10",
      }),
    ).toEqual({ ok: true });

    expect(
      canTransitionLoan({
        from: "pending",
        to: "declined",
        actor: "system",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10",
      }),
    ).toEqual({ ok: true });

    expect(
      canTransitionLoan({
        from: "pending",
        to: "cancelled",
        actor: "borrower",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10",
      }),
    ).toEqual({ ok: true });

    expect(
      canTransitionLoan({
        from: "pending",
        to: "cancelled",
        actor: "lender",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10",
      }).ok,
    ).toBe(false);
  });

  it("enforces approved -> cancelled strictly before startDate and approved -> returned for lender anytime", () => {
    expect(
      canTransitionLoan({
        from: "approved",
        to: "cancelled",
        actor: "borrower",
        startDate: "2026-05-12",
        todayUtc: "2026-05-11",
      }),
    ).toEqual({ ok: true });

    expect(
      canTransitionLoan({
        from: "approved",
        to: "cancelled",
        actor: "lender",
        startDate: "2026-05-12",
        todayUtc: "2026-05-12",
      }).ok,
    ).toBe(false);

    expect(
      canTransitionLoan({
        from: "approved",
        to: "returned",
        actor: "lender",
        startDate: "2026-05-12",
        todayUtc: "2026-05-10", // early return
      }),
    ).toEqual({ ok: true });

    expect(
      canTransitionLoan({
        from: "approved",
        to: "returned",
        actor: "borrower",
        startDate: "2026-05-12",
        todayUtc: "2026-05-15",
      }).ok,
    ).toBe(false);
  });

  it("forbids all transitions out of terminal statuses", () => {
    for (const terminal of ["declined", "cancelled", "returned"] as const) {
      expect(
        canTransitionLoan({
          from: terminal,
          to: "approved",
          actor: "lender",
          startDate: "2026-05-12",
          todayUtc: "2026-05-10",
        }).ok,
      ).toBe(false);
    }
  });

  it("derives Overdue only for unreturned approved loans whose endDate is strictly before todayUtc", () => {
    expect(isLoanOverdue({ status: "approved", endDate: "2026-05-09" }, "2026-05-10")).toBe(true);
    expect(isLoanOverdue({ status: "approved", endDate: "2026-05-10" }, "2026-05-10")).toBe(false);
    expect(isLoanOverdue({ status: "returned", endDate: "2026-05-09" }, "2026-05-10")).toBe(false);
    expect(isLoanOverdue({ status: "pending", endDate: "2026-05-09" }, "2026-05-10")).toBe(false);
  });

  it("derives Listing Availability from unreturned approved loans covering today or overdue", () => {
    expect(deriveListingAvailability([], "2026-05-10")).toBe("Available");

    // Future approved loan does not make it Currently Borrowed today
    expect(
      deriveListingAvailability(
        [{ status: "approved", startDate: "2026-05-11", endDate: "2026-05-15" }],
        "2026-05-10",
      ),
    ).toBe("Available");

    // Pending or returned loans covering today do not block Availability
    expect(
      deriveListingAvailability(
        [
          { status: "pending", startDate: "2026-05-10", endDate: "2026-05-12" },
          { status: "returned", startDate: "2026-05-08", endDate: "2026-05-12" },
        ],
        "2026-05-10",
      ),
    ).toBe("Available");

    // Active approved loan covering today -> Currently Borrowed
    expect(
      deriveListingAvailability(
        [{ status: "approved", startDate: "2026-05-10", endDate: "2026-05-12" }],
        "2026-05-10",
      ),
    ).toBe("Currently Borrowed");

    // Overdue unreturned approved loan -> Currently Borrowed
    expect(
      deriveListingAvailability(
        [{ status: "approved", startDate: "2026-05-01", endDate: "2026-05-05" }],
        "2026-05-10",
      ),
    ).toBe("Currently Borrowed");
  });

  it("finds overlapping loans for conflict detection", () => {
    const loans = [
      { id: "a", startDate: "2026-05-01", endDate: "2026-05-05" },
      { id: "b", startDate: "2026-05-10", endDate: "2026-05-12" },
      { id: "c", startDate: "2026-05-15", endDate: "2026-05-20" },
    ];
    const overlapping = findOverlappingLoans(
      { startDate: "2026-05-05", endDate: "2026-05-11" },
      loans,
    );
    expect(overlapping.map((l) => l.id)).toEqual(["a", "b"]);
  });
});
