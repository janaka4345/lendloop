"use client";

import { useQuery } from "convex/react";
import { AlertTriangle, Clock, History, Inbox } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { useHasConvexProvider, useSyncedCurrentUser } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LoanCard, type LoanCardItem } from "./loan-card";

function LiveLoansBoard({ mode }: { mode: "borrower" | "lender" }) {
  const [tab, setTab] = useState<"active" | "history">("active");
  const currentUser = useSyncedCurrentUser();
  const myRequests = useQuery(
    api.lending.queries.listMyRequests,
    currentUser && mode === "borrower" ? {} : "skip",
  );
  const incomingRequests = useQuery(
    api.lending.queries.listIncomingRequests,
    currentUser && mode === "lender" ? {} : "skip",
  );

  const data = mode === "borrower" ? myRequests : incomingRequests;

  if (data === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="bg-muted h-10 w-64 animate-pulse rounded-lg" />
        <div className="bg-muted h-44 w-full animate-pulse rounded-xl" />
        <div className="bg-muted h-44 w-full animate-pulse rounded-xl" />
      </div>
    );
  }

  const overdueLoans = data.overdue as LoanCardItem[];
  const activeLoans = data.active as LoanCardItem[];
  const historyLoans = data.history as LoanCardItem[];
  const activeTotalCount = overdueLoans.length + activeLoans.length;

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Loan view tabs"
        className="border-border inline-flex rounded-lg border p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "active"}
          onClick={() => setTab("active")}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            tab === "active"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          Active
          <Badge
            variant={tab === "active" ? "secondary" : "outline"}
            className="ml-0.5 text-[11px]"
          >
            {activeTotalCount}
          </Badge>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            tab === "history"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          History
          <Badge
            variant={tab === "history" ? "secondary" : "outline"}
            className="ml-0.5 text-[11px]"
          >
            {historyLoans.length}
          </Badge>
        </button>
      </div>

      {tab === "active" ? (
        activeTotalCount === 0 ? (
          <div className="border-border bg-card rounded-xl border border-dashed p-10 text-center">
            <div className="bg-muted mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full">
              <Inbox className="text-muted-foreground h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold">
              {mode === "borrower" ? "No active Loan requests" : "No active incoming requests"}
            </h2>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
              {mode === "borrower"
                ? "Browse neighborhood Listings in All Tools to request your next Loan."
                : "When neighbors request to borrow your Listings, they will appear here."}
            </p>
            <div className="mt-5">
              <Button asChild>
                <Link href={mode === "borrower" ? "/listings" : "/my-listings"}>
                  {mode === "borrower" ? "Browse All Tools" : "View My Listings"}
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {overdueLoans.length > 0 ? (
              <section aria-labelledby="overdue-section-heading" className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <h2 id="overdue-section-heading" className="text-sm font-semibold">
                      Action Needed — Overdue
                    </h2>
                  </div>
                  <Badge variant="destructive">{overdueLoans.length}</Badge>
                </div>
                <div className="space-y-4">
                  {overdueLoans.map((loan) => (
                    <LoanCard key={loan._id} loan={loan} />
                  ))}
                </div>
              </section>
            ) : null}

            {activeLoans.length > 0 ? (
              <section aria-labelledby="active-section-heading" className="space-y-3">
                <h2
                  id="active-section-heading"
                  className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
                >
                  Pending &amp; Approved ({activeLoans.length})
                </h2>
                <div className="space-y-4">
                  {activeLoans.map((loan) => (
                    <LoanCard key={loan._id} loan={loan} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )
      ) : historyLoans.length === 0 ? (
        <div className="border-border bg-card rounded-xl border border-dashed p-10 text-center">
          <h2 className="text-base font-semibold">No Loan history yet</h2>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Returned, declined, and cancelled Loans will appear here for your records.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {historyLoans.map((loan) => (
            <LoanCard key={loan._id} loan={loan} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LoansBoardView({ mode }: { mode: "borrower" | "lender" }) {
  const hasConvex = useHasConvexProvider();
  if (!hasConvex) {
    return (
      <div className="border-border bg-card rounded-xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Connect Clerk and Convex to view and manage Loans.
        </p>
      </div>
    );
  }

  return <LiveLoansBoard mode={mode} />;
}
