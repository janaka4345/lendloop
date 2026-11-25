import { ConvexError } from "convex/values";
import { z } from "zod";
import type { AppErrorData } from "../../../convex/lib/errors";
import { dateRangesOverlap, validateLoanDateRange, type UtcDateRange } from "@/domain/dates";
import { DOMAIN_LIMITS, type AutomationEventType, type LoanStatus } from "@/domain/types";

/**
 * Extracts a safe user-facing message from a ConvexError while suppressing raw runtime errors.
 */
export function extractAppErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as Partial<AppErrorData> | undefined;
    if (data?.message) return data.message;
  }
  return fallback;
}

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const AUTOMATION_EVENT_LABELS: Record<AutomationEventType, string> = {
  loan_requested: "Loan request notification",
  loan_approved: "Approval notification",
  loan_declined: "Decline notification",
  loan_cancelled: "Cancellation notification",
  loan_returned: "Return confirmation",
  overdue_reminder: "Overdue reminder",
};

export function borrowRequestSchema(
  todayUtc: string,
  bookedRanges: ReadonlyArray<UtcDateRange> = [],
) {
  return z
    .object({
      startDate: z.string().min(1, "Please select a start date."),
      endDate: z.string().min(1, "Please select an end date."),
      note: z
        .string()
        .trim()
        .max(
          DOMAIN_LIMITS.MAX_LOAN_NOTE_LENGTH,
          `Note cannot exceed ${DOMAIN_LIMITS.MAX_LOAN_NOTE_LENGTH} characters.`,
        )
        .default(""),
    })
    .superRefine((values, ctx) => {
      const validation = validateLoanDateRange(values.startDate, values.endDate, todayUtc);
      if (!validation.ok) {
        const path =
          validation.code === "END_BEFORE_START" || validation.code === "DURATION_EXCEEDS_MAX"
            ? ["endDate"]
            : ["startDate"];
        ctx.addIssue({
          code: "custom",
          path,
          message: validation.message,
        });
        return;
      }

      const overlapsBooked = bookedRanges.some((range) =>
        dateRangesOverlap({ startDate: values.startDate, endDate: values.endDate }, range),
      );
      if (overlapsBooked) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "Those dates overlap an already approved Loan. Please choose different dates.",
        });
      }
    });
}

export type BorrowRequestInput = z.input<ReturnType<typeof borrowRequestSchema>>;
export type BorrowRequestValues = z.output<ReturnType<typeof borrowRequestSchema>>;

export const declineLoanSchema = z.object({
  decisionReason: z
    .string()
    .trim()
    .max(
      DOMAIN_LIMITS.MAX_REASON_LENGTH,
      `Reason cannot exceed ${DOMAIN_LIMITS.MAX_REASON_LENGTH} characters.`,
    )
    .default(""),
});

export type DeclineLoanInput = z.input<typeof declineLoanSchema>;
export type DeclineLoanValues = z.output<typeof declineLoanSchema>;
