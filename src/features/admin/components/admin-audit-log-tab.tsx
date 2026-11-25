"use client";

import { useQuery } from "convex/react";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AuditAction } from "@/domain/types";
import { AUDIT_ACTION_LABELS, AUDIT_ACTION_OPTIONS } from "@/features/admin/schema";

const PAGE_SIZE = 25;

function formatUtcTimestamp(timestampMs: number): string {
  return new Date(timestampMs)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function AdminAuditLogTab() {
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const currentCursor = cursorHistory[pageIndex] ?? null;

  const page = useQuery(api.audit.queries.listAuditLogs, {
    ...(actionFilter !== "all" ? { action: actionFilter } : {}),
    cursor: currentCursor,
    limit: PAGE_SIZE,
  });

  const handleActionChange = (nextAction: AuditAction | "all") => {
    setActionFilter(nextAction);
    setCursorHistory([null]);
    setPageIndex(0);
  };

  const handleNextPage = () => {
    if (!page || page.isDone || !page.continueCursor) return;
    const nextIndex = pageIndex + 1;
    setCursorHistory((prev) => {
      const updated = prev.slice(0, nextIndex);
      updated.push(page.continueCursor);
      return updated;
    });
    setPageIndex(nextIndex);
  };

  const handlePrevPage = () => {
    if (pageIndex === 0) return;
    setPageIndex((prev) => Math.max(0, prev - 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-action-filter" className="shrink-0 text-xs font-medium">
            Filter by action
          </Label>
          <select
            id="audit-action-filter"
            value={actionFilter}
            onChange={(e) => handleActionChange(e.target.value as AuditAction | "all")}
            className="border-input bg-background text-foreground focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="all">All actions</option>
            {AUDIT_ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-muted-foreground text-xs">
          Append-only governance trail (zero PII in metadata).
        </p>
      </div>

      {page === undefined ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="bg-muted h-16 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : page.items.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-xl border p-10 text-center">
          <ScrollText className="text-muted-foreground h-8 w-8" aria-hidden="true" />
          <p className="text-sm font-medium">No Audit Log entries match this filter.</p>
        </div>
      ) : (
        <>
          <div className="border-border bg-card overflow-hidden rounded-xl border">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="border-border bg-muted/40 text-muted-foreground border-b text-xs uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Timestamp
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Actor
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Target
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Metadata
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {page.items.map((entry) => (
                    <tr key={entry._id} className="hover:bg-muted/20 align-top transition-colors">
                      <td className="text-muted-foreground px-4 py-3 font-mono text-xs whitespace-nowrap">
                        {formatUtcTimestamp(entry.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{AUDIT_ACTION_LABELS[entry.action]}</div>
                        <div className="text-muted-foreground font-mono text-[11px]">
                          {entry.action}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={entry.actorRole === "admin" ? "default" : "secondary"}
                          className="capitalize"
                        >
                          {entry.actorRole}
                        </Badge>
                        {entry.actorId ? (
                          <div className="text-muted-foreground mt-1 font-mono text-[11px]">
                            {entry.actorId}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="capitalize">
                          {entry.targetType}
                        </Badge>
                        <div className="text-muted-foreground mt-1 font-mono text-[11px]">
                          {entry.targetId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {entry.metadata && Object.keys(entry.metadata).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(entry.metadata).map(([key, value]) => (
                              <span
                                key={key}
                                className="bg-muted text-muted-foreground inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px]"
                              >
                                {key}={String(value)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Page {pageIndex + 1}</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pageIndex === 0}
                onClick={handlePrevPage}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page.isDone}
                onClick={handleNextPage}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
