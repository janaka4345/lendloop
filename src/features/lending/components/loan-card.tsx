"use client";

import { useMutation } from "convex/react";
import {
  AlertTriangle,
  Award,
  CalendarDays,
  Check,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { calculateInclusiveDays } from "@/domain/dates";
import { DOMAIN_LIMITS, type ListingCategory, type LoanStatus } from "@/domain/types";
import {
  LOAN_STATUS_LABELS,
  declineLoanSchema,
  extractAppErrorMessage,
} from "@/features/lending/schema";
import { CATEGORY_LABELS } from "@/features/listings/schema";
import { cn } from "@/lib/utils";
import {
  AutomationActivityFooter,
  type LoanAutomationActivityItem,
} from "./automation-activity-footer";

export interface LoanCardItem {
  _id: Id<"loans">;
  status: LoanStatus;
  isOverdue: boolean;
  startDate: string;
  endDate: string;
  note?: string;
  decisionReason?: string;
  returnedAt?: number;
  createdAt: number;
  updatedAt: number;
  viewerRole: "borrower" | "lender" | "admin";
  listing: {
    id: Id<"listings">;
    name: string;
    category: ListingCategory;
    isArchived: boolean;
  };
  counterparty: {
    id: Id<"users">;
    displayName: string;
    trustedLender: boolean;
  };
  canApprove: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canMarkReturned: boolean;
  conflictingPendingCount: number;
  automationActivities: ReadonlyArray<LoanAutomationActivityItem>;
}

type DialogKind = "approve" | "decline" | "cancel" | "return" | null;

export function LoanCard({ loan }: { loan: LoanCardItem }) {
  const approveLoan = useMutation(api.lending.mutations.approveLoan);
  const declineLoan = useMutation(api.lending.mutations.declineLoan);
  const cancelLoan = useMutation(api.lending.mutations.cancelLoan);
  const markLoanReturned = useMutation(api.lending.mutations.markLoanReturned);

  const [activeDialog, setActiveDialog] = useState<DialogKind>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const durationDays = calculateInclusiveDays(loan.startDate, loan.endDate);
  const counterpartyLabel = loan.viewerRole === "borrower" ? "Lender" : "Borrower";

  const closeDialog = () => {
    if (submitting) return;
    setActiveDialog(null);
    setDialogError(null);
    setDeclineReason("");
  };

  const handleApprove = async () => {
    setSubmitting(true);
    setDialogError(null);
    try {
      const result = await approveLoan({ loanId: loan._id });
      toast.success(
        result.autoDeclinedCount > 0
          ? `Loan approved. ${result.autoDeclinedCount} overlapping request(s) auto-declined.`
          : "Loan approved.",
      );
      setActiveDialog(null);
    } catch (error) {
      setDialogError(extractAppErrorMessage(error, "Could not approve Loan."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    const parsed = declineLoanSchema.safeParse({ decisionReason: declineReason });
    if (!parsed.success) {
      setDialogError(parsed.error.issues[0]?.message ?? "Invalid reason.");
      return;
    }

    setSubmitting(true);
    setDialogError(null);
    try {
      await declineLoan({
        loanId: loan._id,
        ...(parsed.data.decisionReason ? { decisionReason: parsed.data.decisionReason } : {}),
      });
      toast.success("Loan declined.");
      setActiveDialog(null);
      setDeclineReason("");
    } catch (error) {
      setDialogError(extractAppErrorMessage(error, "Could not decline Loan."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    setDialogError(null);
    try {
      await cancelLoan({ loanId: loan._id });
      toast.success("Loan cancelled.");
      setActiveDialog(null);
    } catch (error) {
      setDialogError(extractAppErrorMessage(error, "Could not cancel Loan."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkReturned = async () => {
    setSubmitting(true);
    setDialogError(null);
    try {
      await markLoanReturned({ loanId: loan._id });
      toast.success("Loan marked as returned.");
      setActiveDialog(null);
    } catch (error) {
      setDialogError(extractAppErrorMessage(error, "Could not mark Loan as returned."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      className={cn(
        "border-border bg-card text-card-foreground overflow-hidden rounded-xl border shadow-xs",
        loan.isOverdue && "border-l-4 border-l-rose-600 dark:border-l-rose-500",
      )}
    >
      {loan.isOverdue ? (
        <div className="flex items-center gap-2 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-800 dark:text-rose-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Overdue — due back {loan.endDate} (UTC)</span>
        </div>
      ) : null}

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {loan.isOverdue ? (
                <Badge variant="destructive">Overdue</Badge>
              ) : (
                <Badge
                  variant={
                    loan.status === "approved"
                      ? "default"
                      : loan.status === "declined"
                        ? "destructive"
                        : "secondary"
                  }
                  className={
                    loan.status === "approved"
                      ? "bg-emerald-600 text-white hover:bg-emerald-600"
                      : loan.status === "pending"
                        ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        : undefined
                  }
                >
                  {LOAN_STATUS_LABELS[loan.status]}
                </Badge>
              )}

              <Badge variant="outline">{CATEGORY_LABELS[loan.listing.category]}</Badge>

              {loan.listing.isArchived ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Listing removed
                </Badge>
              ) : null}
            </div>

            <h3 className="text-base font-semibold tracking-tight sm:text-lg">
              <Link
                href={`/listings/${loan.listing.id}`}
                className="hover:text-primary transition-colors hover:underline"
              >
                {loan.listing.name}
              </Link>
            </h3>

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <span>
                  {counterpartyLabel}:{" "}
                  <strong className="text-foreground font-medium">
                    {loan.counterparty.displayName}
                  </strong>
                </span>
                {loan.viewerRole === "borrower" && loan.counterparty.trustedLender ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-sky-500/15 text-[11px] text-sky-800 dark:text-sky-300"
                  >
                    <Award className="h-3 w-3" aria-hidden="true" />
                    Trusted Lender
                  </Badge>
                ) : null}
              </span>

              <span className="bg-muted/70 text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
                <CalendarDays className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
                {loan.startDate}
                {loan.endDate !== loan.startDate ? ` → ${loan.endDate}` : ""} ({durationDays}{" "}
                {durationDays === 1 ? "day" : "days"})
              </span>
            </div>
          </div>

          {loan.canApprove || loan.canDecline || loan.canCancel || loan.canMarkReturned ? (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {loan.canApprove ? (
                <Button type="button" size="sm" onClick={() => setActiveDialog("approve")}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Approve
                </Button>
              ) : null}
              {loan.canDecline ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveDialog("decline")}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Decline
                </Button>
              ) : null}
              {loan.canMarkReturned ? (
                <Button type="button" size="sm" onClick={() => setActiveDialog("return")}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Mark Returned
                </Button>
              ) : null}
              {loan.canCancel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveDialog("cancel")}
                >
                  Cancel Loan
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {loan.note ? (
          <div className="bg-muted/40 border-border flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
            <MessageSquare
              className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Borrower note: </span>
              {loan.note}
            </p>
          </div>
        ) : null}

        {loan.decisionReason ? (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            <span className="font-medium">Decline reason: </span>
            {loan.decisionReason}
          </div>
        ) : null}
      </div>

      <AutomationActivityFooter activities={loan.automationActivities} />

      {/* Approve Confirmation Dialog */}
      <ModalDialog
        open={activeDialog === "approve"}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title="Approve Loan request?"
        description={
          <>
            Approve <strong className="text-foreground">{loan.counterparty.displayName}</strong> to
            borrow <strong className="text-foreground">{loan.listing.name}</strong> from{" "}
            <strong className="text-foreground">{loan.startDate}</strong> to{" "}
            <strong className="text-foreground">{loan.endDate}</strong> (UTC).
          </>
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleApprove} disabled={submitting}>
              {submitting ? "Approving..." : "Confirm Approval"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {loan.conflictingPendingCount > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                Warning: Approving this Loan will automatically decline{" "}
                <strong>
                  {loan.conflictingPendingCount} competing overlapping pending{" "}
                  {loan.conflictingPendingCount === 1 ? "request" : "requests"}
                </strong>{" "}
                with reason &ldquo;Dates no longer available&rdquo; and notify those Borrowers.
              </AlertDescription>
            </Alert>
          ) : null}
          {dialogError ? (
            <Alert variant="destructive">
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </ModalDialog>

      {/* Decline Dialog with optional decisionReason */}
      <ModalDialog
        open={activeDialog === "decline"}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title="Decline Loan request?"
        description={
          <>
            Decline <strong className="text-foreground">{loan.counterparty.displayName}</strong>
            &apos;s request for <strong className="text-foreground">{loan.listing.name}</strong>.
          </>
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDecline}
              disabled={submitting}
            >
              {submitting ? "Declining..." : "Decline Request"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {dialogError ? (
            <Alert variant="destructive">
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`decline-reason-${loan._id}`}>Reason (optional)</Label>
              <span className="text-muted-foreground text-xs">
                {declineReason.length}/{DOMAIN_LIMITS.MAX_REASON_LENGTH}
              </span>
            </div>
            <Textarea
              id={`decline-reason-${loan._id}`}
              rows={3}
              maxLength={DOMAIN_LIMITS.MAX_REASON_LENGTH}
              placeholder="Let the Borrower know why these dates don't work..."
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
      </ModalDialog>

      {/* Cancel Confirmation Dialog */}
      <ModalDialog
        open={activeDialog === "cancel"}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title="Cancel this Loan?"
        description={
          <>
            Cancel the {loan.status} Loan for{" "}
            <strong className="text-foreground">{loan.listing.name}</strong> ({loan.startDate} →{" "}
            {loan.endDate}). The other party will be notified.
          </>
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
              Keep Loan
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancel}
              disabled={submitting}
            >
              {submitting ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </>
        }
      >
        {dialogError ? (
          <Alert variant="destructive">
            <AlertDescription>{dialogError}</AlertDescription>
          </Alert>
        ) : null}
      </ModalDialog>

      {/* Mark Returned Confirmation Dialog */}
      <ModalDialog
        open={activeDialog === "return"}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title="Mark Loan as returned?"
        description={
          <>
            Confirm that{" "}
            <strong className="text-foreground">{loan.counterparty.displayName}</strong> has
            returned <strong className="text-foreground">{loan.listing.name}</strong>. This will
            move the Loan to History and make the Listing available again.
          </>
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleMarkReturned} disabled={submitting}>
              {submitting ? "Saving..." : "Confirm Return"}
            </Button>
          </>
        }
      >
        {dialogError ? (
          <Alert variant="destructive">
            <AlertDescription>{dialogError}</AlertDescription>
          </Alert>
        ) : null}
      </ModalDialog>
    </article>
  );
}
