import { describe, expect, it } from "vitest";
import { todayUtcDate } from "../../src/domain/dates";
import { borrowRequestSchema, declineLoanSchema } from "../../src/features/lending/schema";

function addDaysUtc(baseUtc: string, days: number): string {
  const [year, month, day] = baseUtc.split("-").map(Number);
  const ms = Date.UTC(year!, month! - 1, day!) + days * 86_400_000;
  return todayUtcDate(new Date(ms));
}

describe("lending form schemas", () => {
  const today = "2026-11-25";

  it("accepts a valid borrow request with optional trimmed note", () => {
    const schema = borrowRequestSchema(today);
    const result = schema.safeParse({
      startDate: today,
      endDate: addDaysUtc(today, 3),
      note: "  Need it for weekend deck repair  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe("Need it for weekend deck repair");
    }
  });

  it("rejects past start dates and ranges exceeding 30 days", () => {
    const schema = borrowRequestSchema(today);

    const past = schema.safeParse({
      startDate: addDaysUtc(today, -1),
      endDate: today,
      note: "",
    });
    expect(past.success).toBe(false);

    const tooLong = schema.safeParse({
      startDate: today,
      endDate: addDaysUtc(today, 30),
      note: "",
    });
    expect(tooLong.success).toBe(false);
  });

  it("rejects notes and decline reasons longer than 300 characters", () => {
    const schema = borrowRequestSchema(today);
    const longText = "a".repeat(301);

    expect(
      schema.safeParse({
        startDate: today,
        endDate: today,
        note: longText,
      }).success,
    ).toBe(false);

    expect(declineLoanSchema.safeParse({ decisionReason: longText }).success).toBe(false);
    expect(declineLoanSchema.safeParse({ decisionReason: "  Busy this weekend  " }).success).toBe(
      true,
    );
  });

  it("rejects ranges overlapping already approved Loan dates on the client", () => {
    const schema = borrowRequestSchema(today, [
      { startDate: addDaysUtc(today, 2), endDate: addDaysUtc(today, 4) },
    ]);

    expect(
      schema.safeParse({
        startDate: addDaysUtc(today, 1),
        endDate: addDaysUtc(today, 2),
        note: "",
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        startDate: addDaysUtc(today, 5),
        endDate: addDaysUtc(today, 6),
        note: "",
      }).success,
    ).toBe(true);
  });
});
