import { DOMAIN_LIMITS } from "./types";

const UTC_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface UtcDateRange {
  startDate: string;
  endDate: string;
}

export type LoanDateValidationCode =
  "INVALID_DATE_FORMAT" | "START_IN_PAST" | "END_BEFORE_START" | "DURATION_EXCEEDS_MAX";

export type LoanDateValidationResult =
  { ok: true; durationDays: number } | { ok: false; code: LoanDateValidationCode; message: string };

function parseUtcDateToEpochMs(value: string): number | null {
  const match = UTC_DATE_REGEX.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return utcMs;
}

export function isValidUtcDateString(value: string): boolean {
  return parseUtcDateToEpochMs(value) !== null;
}

export function toUtcDateString(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayUtcDate(now: Date = new Date()): string {
  return toUtcDateString(now);
}

export function calculateInclusiveDays(startDate: string, endDate: string): number {
  const startMs = parseUtcDateToEpochMs(startDate);
  const endMs = parseUtcDateToEpochMs(endDate);
  if (startMs === null || endMs === null) {
    throw new RangeError("Dates must be valid UTC YYYY-MM-DD strings");
  }
  return Math.round((endMs - startMs) / MS_PER_DAY) + 1;
}

export function validateLoanDateRange(
  startDate: string,
  endDate: string,
  todayUtc: string,
): LoanDateValidationResult {
  const startMs = parseUtcDateToEpochMs(startDate);
  const endMs = parseUtcDateToEpochMs(endDate);
  const todayMs = parseUtcDateToEpochMs(todayUtc);

  if (startMs === null || endMs === null || todayMs === null) {
    return {
      ok: false,
      code: "INVALID_DATE_FORMAT",
      message: "Dates must be valid UTC YYYY-MM-DD calendar dates.",
    };
  }

  if (startMs < todayMs) {
    return {
      ok: false,
      code: "START_IN_PAST",
      message: "Start date cannot be in the past.",
    };
  }

  if (endMs < startMs) {
    return {
      ok: false,
      code: "END_BEFORE_START",
      message: "End date must be on or after the start date.",
    };
  }

  const durationDays = Math.round((endMs - startMs) / MS_PER_DAY) + 1;
  if (durationDays > DOMAIN_LIMITS.MAX_LOAN_DURATION_DAYS) {
    return {
      ok: false,
      code: "DURATION_EXCEEDS_MAX",
      message: `Loan duration cannot exceed ${DOMAIN_LIMITS.MAX_LOAN_DURATION_DAYS} days.`,
    };
  }

  return { ok: true, durationDays };
}

export function dateRangesOverlap(rangeA: UtcDateRange, rangeB: UtcDateRange): boolean {
  return rangeA.startDate <= rangeB.endDate && rangeB.startDate <= rangeA.endDate;
}
