"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  calculateInclusiveDays,
  dateRangesOverlap,
  toUtcDateString,
  type UtcDateRange,
} from "@/domain/dates";
import { DOMAIN_LIMITS } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface UtcRangeCalendarProps {
  todayUtc: string;
  bookedRanges: ReadonlyArray<UtcDateRange>;
  startDate: string;
  endDate: string;
  onChange: (next: { startDate: string; endDate: string }) => void;
  disabled?: boolean;
}

function parseYearMonth(utcDate: string): { year: number; month: number } {
  const [yearStr, monthStr] = utcDate.split("-");
  return {
    year: Number(yearStr) || new Date().getUTCFullYear(),
    month: (Number(monthStr) || 1) - 1,
  };
}

function isDateBooked(dateStr: string, bookedRanges: ReadonlyArray<UtcDateRange>): boolean {
  return bookedRanges.some((range) => dateStr >= range.startDate && dateStr <= range.endDate);
}

export function UtcRangeCalendar({
  todayUtc,
  bookedRanges,
  startDate,
  endDate,
  onChange,
  disabled = false,
}: UtcRangeCalendarProps) {
  const initialMonth = parseYearMonth(startDate || todayUtc);
  const [viewYear, setViewYear] = useState(initialMonth.year);
  const [viewMonth, setViewMonth] = useState(initialMonth.month);
  const [selectionHint, setSelectionHint] = useState<string | null>(null);

  const todayMonth = parseYearMonth(todayUtc);
  const canGoPrev =
    viewYear > todayMonth.year || (viewYear === todayMonth.year && viewMonth > todayMonth.month);

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startWeekday = firstDayOfMonth.getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

    const cells: Array<{ dateStr: string; dayNumber: number } | null> = [];
    for (let i = 0; i < startWeekday; i += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = toUtcDateString(new Date(Date.UTC(viewYear, viewMonth, day)));
      cells.push({ dateStr, dayNumber: day });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    if (!canGoPrev) return;
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDate = (clicked: string) => {
    if (disabled) return;
    setSelectionHint(null);

    // Start fresh if nothing selected, or both endpoints already form a multi-day range, or clicked < startDate
    if (!startDate || (startDate && endDate && startDate !== endDate) || clicked < startDate) {
      onChange({ startDate: clicked, endDate: clicked });
      return;
    }

    // Extending from single-day startDate to clicked
    if (clicked === startDate) {
      onChange({ startDate: clicked, endDate: clicked });
      return;
    }

    const duration = calculateInclusiveDays(startDate, clicked);
    if (duration > DOMAIN_LIMITS.MAX_LOAN_DURATION_DAYS) {
      setSelectionHint(
        `Loan duration cannot exceed ${DOMAIN_LIMITS.MAX_LOAN_DURATION_DAYS} days. Starting a new range from ${clicked}.`,
      );
      onChange({ startDate: clicked, endDate: clicked });
      return;
    }

    const hasBookedInRange = bookedRanges.some((range) =>
      dateRangesOverlap({ startDate, endDate: clicked }, range),
    );
    if (hasBookedInRange) {
      setSelectionHint(
        `Range overlaps an already booked date. Starting a new selection from ${clicked}.`,
      );
      onChange({ startDate: clicked, endDate: clicked });
      return;
    }

    onChange({ startDate, endDate: clicked });
  };

  const selectedDays = startDate && endDate ? calculateInclusiveDays(startDate, endDate) : 0;

  return (
    <div className="space-y-3">
      <div className="border-border bg-background rounded-lg border p-3">
        <div className="mb-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handlePrevMonth}
            disabled={!canGoPrev || disabled}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="text-sm font-semibold">
            {MONTH_NAMES[viewMonth]} {viewYear}{" "}
            <span className="text-muted-foreground text-xs font-normal">(UTC)</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleNextMonth}
            disabled={disabled}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="mb-1 grid grid-cols-7 text-center">
          {WEEKDAY_LABELS.map((day) => (
            <div key={day} className="text-muted-foreground py-1 text-[11px] font-medium">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Borrow date range calendar">
          {calendarCells.map((cell, idx) => {
            if (!cell) {
              return <div key={`empty-${idx}`} className="h-8" />;
            }

            const isPast = cell.dateStr < todayUtc;
            const isBooked = isDateBooked(cell.dateStr, bookedRanges);
            const isDisabled = disabled || isPast || isBooked;
            const isStart = startDate === cell.dateStr;
            const isEnd = endDate === cell.dateStr;
            const isInRange =
              Boolean(startDate && endDate) && cell.dateStr > startDate && cell.dateStr < endDate;
            const isToday = cell.dateStr === todayUtc;

            return (
              <button
                key={cell.dateStr}
                type="button"
                disabled={isDisabled}
                onClick={() => handleSelectDate(cell.dateStr)}
                aria-label={`${cell.dateStr}${isBooked ? " (Booked)" : isPast ? " (Past)" : ""}`}
                aria-pressed={isStart || isEnd || isInRange}
                className={cn(
                  "focus-visible:ring-ring relative flex h-8 w-full items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  isStart || isEnd
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : isInRange
                      ? "bg-primary/15 text-foreground"
                      : isBooked
                        ? "bg-rose-500/10 text-rose-700/70 line-through dark:text-rose-300/70"
                        : isPast
                          ? "text-muted-foreground/40"
                          : "hover:bg-secondary text-foreground",
                  isToday && !isStart && !isEnd && "ring-primary/50 ring-1",
                  isDisabled && "cursor-not-allowed",
                )}
              >
                {cell.dayNumber}
              </button>
            );
          })}
        </div>

        <div className="border-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-[11px]">
          <div className="text-muted-foreground flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="bg-primary inline-block h-2.5 w-2.5 rounded-xs" />
              Selected
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-xs bg-rose-500/25" />
              Booked
            </span>
          </div>
          {startDate ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setSelectionHint(null);
                onChange({ startDate: "", endDate: "" });
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {selectionHint ? (
        <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
          {selectionHint}
        </p>
      ) : null}

      <div className="bg-muted/50 border-border flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
        {startDate && endDate ? (
          <>
            <span className="font-medium">
              {startDate} {endDate !== startDate ? `→ ${endDate}` : ""}
            </span>
            <span className="text-muted-foreground">
              {selectedDays} {selectedDays === 1 ? "day" : "days"} (UTC)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Click a start date, then an end date (max {DOMAIN_LIMITS.MAX_LOAN_DURATION_DAYS} days).
          </span>
        )}
      </div>
    </div>
  );
}
