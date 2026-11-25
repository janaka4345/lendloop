import { z } from "zod";
import { AUDIT_ACTIONS, DOMAIN_LIMITS, type AuditAction } from "@/domain/types";

export const ADMIN_TABS = [
  { id: "users", label: "Users" },
  { id: "listings", label: "Listings" },
  { id: "loans", label: "All Loans" },
  { id: "audit", label: "Audit Log" },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "user.role_changed": "User role changed",
  "user.trusted_lender_toggled": "Trusted Lender toggled",
  "user.deleted": "User deleted",
  "listing.created": "Listing created",
  "listing.updated": "Listing updated",
  "listing.archived": "Listing archived",
  "loan.requested": "Loan requested",
  "loan.approved": "Loan approved",
  "loan.declined": "Loan declined",
  "loan.cancelled": "Loan cancelled",
  "loan.returned": "Loan returned",
};

export const AUDIT_ACTION_OPTIONS: ReadonlyArray<{ value: AuditAction; label: string }> =
  AUDIT_ACTIONS.map((action) => ({
    value: action,
    label: `${AUDIT_ACTION_LABELS[action]} (${action})`,
  }));

export const adminRemoveListingSchema = z.object({
  archiveReason: z
    .string()
    .trim()
    .min(1, "Please provide a reason for removing this Listing.")
    .max(
      DOMAIN_LIMITS.MAX_REASON_LENGTH,
      `Archive reason cannot exceed ${DOMAIN_LIMITS.MAX_REASON_LENGTH} characters.`,
    ),
});

export type AdminRemoveListingFormValues = z.infer<typeof adminRemoveListingSchema>;
