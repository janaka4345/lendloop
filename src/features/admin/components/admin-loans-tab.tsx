"use client";

import { useQuery } from "convex/react";
import { AlertTriangle, Award, CalendarDays, ClipboardList, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { calculateInclusiveDays } from "@/domain/dates";
import { LOAN_STATUSES, type LoanStatus } from "@/domain/types";
import { AutomationActivityFooter } from "@/features/lending/components/automation-activity-footer";
import { LOAN_STATUS_LABELS } from "@/features/lending/schema";
import { CATEGORY_LABELS } from "@/features/listings/schema";
import { cn } from "@/lib/utils";
import { AdminPaginationControls, useCursorPagination } from "./admin-pagination";

const PAGE_SIZE = 25;

export function AdminLoansTab() {
  const [statusFilter, setStatusFilter] = useState<LoanStatus | "all">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const pagination = useCursorPagination();

  const page = useQuery(api.lending.queries.listAllLoansForAdmin, {
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(overdueOnly ? { overdueOnly: true } : {}),
    cursor: pagination.currentCursor,
    limit: PAGE_SIZE,
  });

  const handleStatusChange = (nextStatus: LoanStatus | "all") => {
    setStatusFilter(nextStatus);
    if (nextStatus === "all" || nextStatus !== "approved") {
      setOverdueOnly(false);
    }
    pagination.reset();
  };

  const handleToggleOverdue = () => {
    setOverdueOnly((prev) => {
      const next = !prev;
      if (next && statusFilter !== "all" && statusFilter !== "approved") {
        setStatusFilter("approved");
      }
      return next;
    });
    pagination.reset();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={statusFilter === "all" && !overdueOnly ? "default" : "outline"}
            onClick={() => handleStatusChange("all")}
          >
            All
          </Button>
          {LOAN_STATUSES.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={statusFilter === status ? "default" : "outline"}
              onClick={() => handleStatusChange(status)}
            >
              {LOAN_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant={overdueOnly ? "destructive" : "outline"}
          onClick={handleToggleOverdue}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Overdue only
        </Button>
      </div>

      {page === undefined ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="bg-muted h-32 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : page.items.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-xl border p-10 text-center">
          <ClipboardList className="text-muted-foreground h-8 w-8" aria-hidden="true" />
          <p className="text-sm font-medium">No Loans match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {page.items.map((loan) => {
              const durationDays = calculateInclusiveDays(loan.startDate, loan.endDate);
              return (
                <article
                  key={loan._id}
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

                  <div className="space-y-3 p-4">
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

                    <h3 className="text-base font-semibold tracking-tight">
                      <Link
                        href={`/listings/${loan.listing.id}`}
                        className="hover:text-primary transition-colors hover:underline"
                      >
                        {loan.listing.name}
                      </Link>
                    </h3>

                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span>
                          Lender:{" "}
                          <strong className="text-foreground font-medium">
                            {loan.lender.displayName}
                          </strong>
                        </span>
                        {loan.lender.trustedLender ? (
                          <Badge
                            variant="secondary"
                            className="gap-1 bg-sky-500/15 text-[11px] text-sky-800 dark:text-sky-300"
                          >
                            <Award className="h-3 w-3" aria-hidden="true" />
                            Trusted Lender
                          </Badge>
                        ) : null}
                      </span>

                      <span>
                        Borrower:{" "}
                        <strong className="text-foreground font-medium">
                          {loan.borrower.displayName}
                        </strong>
                      </span>

                      <span className="bg-muted/70 text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
                        <CalendarDays
                          className="text-muted-foreground h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {loan.startDate}
                        {loan.endDate !== loan.startDate ? ` → ${loan.endDate}` : ""} (
                        {durationDays} {durationDays === 1 ? "day" : "days"})
                      </span>
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
                        <span className="font-medium">Decision reason: </span>
                        {loan.decisionReason}
                      </div>
                    ) : null}
                  </div>

                  <AutomationActivityFooter activities={loan.automationActivities} />
                </article>
              );
            })}
          </div>

          <AdminPaginationControls
            pageIndex={pagination.pageIndex}
            isDone={page.isDone}
            onPrev={pagination.goPrev}
            onNext={() => pagination.goNext(page.continueCursor, page.isDone)}
          />
        </>
      )}
    </div>
  );
}
