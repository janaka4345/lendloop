"use client";

import { AlertCircle, Bell, CheckCircle2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useState } from "react";
import type {
  AutomationActivityStatus,
  AutomationEventType,
  AutomationRecipientRole,
} from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { AUTOMATION_EVENT_LABELS } from "@/features/lending/schema";
import { cn } from "@/lib/utils";

export interface LoanAutomationActivityItem {
  _id: string;
  eventType: AutomationEventType;
  status: AutomationActivityStatus;
  attemptCount: number;
  recipientRole: AutomationRecipientRole;
  lastError?: string;
  createdAt: number;
  completedAt?: number;
}

function formatRelativeTime(timestampMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatSummaryLabel(latest: LoanAutomationActivityItem): string {
  const timeText = formatRelativeTime(latest.completedAt ?? latest.createdAt);
  if (latest.status === "sent") {
    return `Notification sent ${timeText}`;
  }
  if (latest.status === "failed") {
    return `Delivery failed (${timeText})`;
  }
  return "Notification pending...";
}

function StatusIcon({ status }: { status: AutomationActivityStatus }) {
  if (status === "sent") {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    );
  }
  if (status === "failed") {
    return (
      <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
    );
  }
  return <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
}

export function AutomationActivityFooter({
  activities,
}: {
  activities: ReadonlyArray<LoanAutomationActivityItem>;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = activities[0];

  return (
    <div className="border-border bg-muted/40 border-t">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="hover:bg-muted/70 flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors"
      >
        <div className="flex min-w-0 items-center gap-2">
          {latest ? (
            <>
              <StatusIcon status={latest.status} />
              <span
                className={cn(
                  "truncate font-medium",
                  latest.status === "failed"
                    ? "text-rose-700 dark:text-rose-300"
                    : "text-muted-foreground",
                )}
              >
                {formatSummaryLabel(latest)}
              </span>
            </>
          ) : (
            <>
              <Bell className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-muted-foreground">No Automation Activity yet</span>
            </>
          )}
        </div>

        <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 font-medium">
          <span>Automation Activity ({activities.length})</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="border-border border-t px-4 py-3">
          {activities.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Notifications for this Loan will appear here once triggered.
            </p>
          ) : (
            <ul className="space-y-2">
              {activities.map((activity) => (
                <li
                  key={activity._id}
                  className="bg-background border-border flex flex-col gap-1 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon status={activity.status} />
                    <span className="font-medium">
                      {AUTOMATION_EVENT_LABELS[activity.eventType]}
                    </span>
                    <span className="text-muted-foreground">
                      → {activity.recipientRole === "lender" ? "Lender" : "Borrower"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        activity.status === "failed"
                          ? "destructive"
                          : activity.status === "sent"
                            ? "secondary"
                            : "outline"
                      }
                      className="text-[11px] capitalize"
                    >
                      {activity.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatRelativeTime(activity.completedAt ?? activity.createdAt)}
                    </span>
                  </div>
                  {activity.lastError ? (
                    <p className="text-destructive mt-1 w-full text-[11px] sm:col-span-2">
                      Error: {activity.lastError}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
