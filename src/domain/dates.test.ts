import { describe, expect, it } from "vitest";
import {
  calculateInclusiveDays,
  dateRangesOverlap,
  isValidUtcDateString,
  toUtcDateString,
  validateLoanDateRange,
} from "./dates";

describe("UTC calendar dates and loan date range validation", () => {
  it("validates strict YYYY-MM-DD calendar dates including leap years", () => {
    expect(isValidUtcDateString("2026-05-01")).toBe(true);
    expect(isValidUtcDateString("2028-02-29")).toBe(true); // leap year
    expect(isValidUtcDateString("2026-02-29")).toBe(false); // non-leap year
    expect(isValidUtcDateString("2026-02-30")).toBe(false);
    expect(isValidUtcDateString("2026-13-01")).toBe(false);
    expect(isValidUtcDateString("2026-00-10")).toBe(false);
    expect(isValidUtcDateString("2026-5-1")).toBe(false);
    expect(isValidUtcDateString("2026-05-01T00:00:00Z")).toBe(false);
    expect(isValidUtcDateString("")).toBe(false);
  });

  it("formats a Date instance to UTC YYYY-MM-DD", () => {
    expect(toUtcDateString(new Date("2026-11-24T23:59:59.999Z"))).toBe("2026-11-24");
    expect(toUtcDateString(new Date("2026-01-02T00:00:00.000Z"))).toBe("2026-01-02");
  });

  it("calculates inclusive day counts across month and year boundaries", () => {
    expect(calculateInclusiveDays("2026-05-01", "2026-05-01")).toBe(1);
    expect(calculateInclusiveDays("2026-05-01", "2026-05-30")).toBe(30);
    expect(calculateInclusiveDays("2026-12-30", "2027-01-02")).toBe(4);
  });

  it("accepts valid inclusive ranges from 1 to 30 days starting today or later", () => {
    expect(validateLoanDateRange("2026-05-10", "2026-05-10", "2026-05-10")).toEqual({
      ok: true,
      durationDays: 1,
    });
    expect(validateLoanDateRange("2026-05-10", "2026-06-08", "2026-05-10")).toEqual({
      ok: true,
      durationDays: 30,
    });
  });

  it("rejects malformed dates, past start dates, inverted ranges, and durations > 30 days", () => {
    expect(validateLoanDateRange("bad-date", "2026-05-12", "2026-05-10")).toMatchObject({
      ok: false,
      code: "INVALID_DATE_FORMAT",
    });
    expect(validateLoanDateRange("2026-05-10", "2026-02-30", "2026-05-10")).toMatchObject({
      ok: false,
      code: "INVALID_DATE_FORMAT",
    });
    expect(validateLoanDateRange("2026-05-09", "2026-05-12", "2026-05-10")).toMatchObject({
      ok: false,
      code: "START_IN_PAST",
    });
    expect(validateLoanDateRange("2026-05-15", "2026-05-14", "2026-05-10")).toMatchObject({
      ok: false,
      code: "END_BEFORE_START",
    });
    expect(validateLoanDateRange("2026-05-10", "2026-06-09", "2026-05-10")).toMatchObject({
      ok: false,
      code: "DURATION_EXCEEDS_MAX",
    });
  });

  it("detects inclusive date range overlaps including single-day boundary touches", () => {
    expect(
      dateRangesOverlap(
        { startDate: "2026-05-10", endDate: "2026-05-12" },
        { startDate: "2026-05-12", endDate: "2026-05-15" },
      ),
    ).toBe(true);
    expect(
      dateRangesOverlap(
        { startDate: "2026-05-10", endDate: "2026-05-15" },
        { startDate: "2026-05-12", endDate: "2026-05-13" },
      ),
    ).toBe(true);
    expect(
      dateRangesOverlap(
        { startDate: "2026-05-10", endDate: "2026-05-12" },
        { startDate: "2026-05-13", endDate: "2026-05-15" },
      ),
    ).toBe(false);
    expect(
      dateRangesOverlap(
        { startDate: "2026-05-16", endDate: "2026-05-18" },
        { startDate: "2026-05-10", endDate: "2026-05-15" },
      ),
    ).toBe(false);
  });
});
