import { describe, expect, it } from "vitest";
import { DOMAIN_LIMITS } from "@/domain/types";
import { listingFormSchema } from "@/features/listings/schema";

describe("Listing form Zod schema", () => {
  it("accepts valid Listing input and trims text fields", () => {
    const parsed = listingFormSchema.safeParse({
      name: "  Cordless Drill  ",
      category: "power_tools",
      condition: "like_new",
      description: "  Includes two 18V batteries and charger.  ",
      imageIds: ["storage_1", "storage_2"],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Cordless Drill");
      expect(parsed.data.description).toBe("Includes two 18V batteries and charger.");
      expect(parsed.data.imageIds).toEqual(["storage_1", "storage_2"]);
    }
  });

  it("enforces server-matched length caps, closed enums, and 5-photo limit", () => {
    expect(
      listingFormSchema.safeParse({
        name: "   ",
        category: "power_tools",
        condition: "good",
        description: "Valid description",
      }).success,
    ).toBe(false);

    expect(
      listingFormSchema.safeParse({
        name: "a".repeat(DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH + 1),
        category: "power_tools",
        condition: "good",
        description: "Valid description",
      }).success,
    ).toBe(false);

    expect(
      listingFormSchema.safeParse({
        name: "Valid Name",
        category: "power_tools",
        condition: "good",
        description: "b".repeat(DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH + 1),
      }).success,
    ).toBe(false);

    expect(
      listingFormSchema.safeParse({
        name: "Valid Name",
        category: "invalid_cat",
        condition: "good",
        description: "Valid description",
      }).success,
    ).toBe(false);

    expect(
      listingFormSchema.safeParse({
        name: "Valid Name",
        category: "other",
        condition: "good",
        description: "Valid description",
        imageIds: ["1", "2", "3", "4", "5", "6"],
      }).success,
    ).toBe(false);
  });
});
