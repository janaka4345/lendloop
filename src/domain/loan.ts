import { dateRangesOverlap, type UtcDateRange } from "./dates";
import type { ListingAvailability, LoanStatus } from "./types";

export type LoanActor = "borrower" | "lender" | "system";

export interface LoanTransitionInput {
  from: LoanStatus;
  to: LoanStatus;
  actor: LoanActor;
  startDate: string;
  todayUtc: string;
}

export type LoanTransitionResult = { ok: true } | { ok: false; reason: string };

export function canTransitionLoan(input: LoanTransitionInput): LoanTransitionResult {
  const { from, to, actor, startDate, todayUtc } = input;

  if (from === "pending") {
    if (to === "approved") {
      return actor === "lender"
        ? { ok: true }
        : { ok: false, reason: "Only the Lender can approve a pending Loan." };
    }
    if (to === "declined") {
      return actor === "lender" || actor === "system"
        ? { ok: true }
        : { ok: false, reason: "Only the Lender or system can decline a pending Loan." };
    }
    if (to === "cancelled") {
      return actor === "borrower" || actor === "system"
        ? { ok: true }
        : { ok: false, reason: "Only the Borrower or system can cancel a pending Loan." };
    }
    return { ok: false, reason: `Cannot transition a pending Loan to ${to}.` };
  }

  if (from === "approved") {
    if (to === "cancelled") {
      if (actor !== "lender" && actor !== "borrower") {
        return {
          ok: false,
          reason: "Only the Lender or Borrower can cancel an approved Loan.",
        };
      }
      if (todayUtc >= startDate) {
        return {
          ok: false,
          reason: "An approved Loan can only be cancelled strictly before its start date.",
        };
      }
      return { ok: true };
    }
    if (to === "returned") {
      return actor === "lender"
        ? { ok: true }
        : { ok: false, reason: "Only the Lender can mark an approved Loan as returned." };
    }
    return { ok: false, reason: `Cannot transition an approved Loan to ${to}.` };
  }

  return { ok: false, reason: `Cannot transition a ${from} Loan to ${to}.` };
}

export function isLoanOverdue(
  loan: { status: LoanStatus; endDate: string },
  todayUtc: string,
): boolean {
  return loan.status === "approved" && todayUtc > loan.endDate;
}

export function deriveListingAvailability(
  loans: ReadonlyArray<{ status: LoanStatus; startDate: string; endDate: string }>,
  todayUtc: string,
): ListingAvailability {
  for (const loan of loans) {
    if (loan.status === "approved" && loan.startDate <= todayUtc) {
      return "Currently Borrowed";
    }
  }
  return "Available";
}

export function findOverlappingLoans<T extends UtcDateRange>(
  candidate: UtcDateRange,
  existing: ReadonlyArray<T>,
): T[] {
  return existing.filter((loan) => dateRangesOverlap(candidate, loan));
}
