import { z } from "zod";
import {
  DOMAIN_LIMITS,
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  type ListingCategory,
  type ListingCondition,
} from "@/domain/types";

export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  power_tools: "Power Tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  hand_tools: "Hand Tools",
  automotive: "Automotive",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};

export const listingFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Listing name is required.")
    .max(
      DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH,
      `Listing name cannot exceed ${DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH} characters.`,
    ),
  category: z.enum(LISTING_CATEGORIES, {
    error: "Please select a valid Category.",
  }),
  condition: z.enum(LISTING_CONDITIONS, {
    error: "Please select a valid Condition.",
  }),
  description: z
    .string()
    .trim()
    .min(1, "Listing description is required.")
    .max(
      DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH,
      `Listing description cannot exceed ${DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH} characters.`,
    ),
  imageIds: z
    .array(z.string().min(1))
    .max(
      DOMAIN_LIMITS.MAX_LISTING_IMAGES,
      `A Listing can have at most ${DOMAIN_LIMITS.MAX_LISTING_IMAGES} photos.`,
    )
    .default([]),
});

export type ListingFormInput = z.input<typeof listingFormSchema>;
export type ListingFormValues = z.output<typeof listingFormSchema>;
