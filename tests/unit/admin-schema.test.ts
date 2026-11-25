import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, DOMAIN_LIMITS } from "@/domain/types";
import { AUDIT_ACTION_LABELS, adminRemoveListingSchema } from "@/features/admin/schema";

describe("adminRemoveListingSchema", () => {
  it("accepts and trims a valid archiveReason", () => {
    const result = adminRemoveListingSchema.safeParse({
      archiveReason: "  Safety recall notice  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archiveReason).toBe("Safety recall notice");
    }
  });

  it("rejects empty or whitespace-only archiveReason", () => {
    expect(adminRemoveListingSchema.safeParse({ archiveReason: "" }).success).toBe(false);
    expect(adminRemoveListingSchema.safeParse({ archiveReason: "   " }).success).toBe(false);
  });

  it("rejects archiveReason exceeding MAX_REASON_LENGTH", () => {
    const tooLong = "a".repeat(DOMAIN_LIMITS.MAX_REASON_LENGTH + 1);
    expect(adminRemoveListingSchema.safeParse({ archiveReason: tooLong }).success).toBe(false);
  });
});

describe("AUDIT_ACTION_LABELS", () => {
  it("defines a label for every canonical AuditAction", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
  });
});
