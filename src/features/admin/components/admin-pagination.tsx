"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function useCursorPagination() {
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);

  const currentCursor = cursorHistory[pageIndex] ?? null;

  const reset = () => {
    setCursorHistory([null]);
    setPageIndex(0);
  };

  const goNext = (continueCursor: string | undefined, isDone: boolean) => {
    if (isDone || !continueCursor) return;
    const nextIndex = pageIndex + 1;
    setCursorHistory((prev) => {
      const updated = prev.slice(0, nextIndex);
      updated.push(continueCursor);
      return updated;
    });
    setPageIndex(nextIndex);
  };

  const goPrev = () => {
    setPageIndex((prev) => Math.max(0, prev - 1));
  };

  return {
    currentCursor,
    pageIndex,
    reset,
    goNext,
    goPrev,
  };
}

export function AdminPaginationControls({
  pageIndex,
  isDone,
  onPrev,
  onNext,
}: {
  pageIndex: number;
  isDone: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-muted-foreground text-xs">Page {pageIndex + 1}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pageIndex === 0}
          onClick={onPrev}
        >
          Previous
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isDone} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
