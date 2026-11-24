export const DOMAIN_SLICES = ["listings", "lending", "users", "automation", "audit"] as const;
export type DomainSlice = (typeof DOMAIN_SLICES)[number];

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LISTING_CATEGORIES = [
  "power_tools",
  "garden",
  "kitchen",
  "camping",
  "hand_tools",
  "automotive",
  "cleaning",
  "other",
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CONDITIONS = ["new", "like_new", "good", "fair"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export const LOAN_STATUSES = ["pending", "approved", "declined", "cancelled", "returned"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LISTING_AVAILABILITIES = ["Available", "Currently Borrowed"] as const;
export type ListingAvailability = (typeof LISTING_AVAILABILITIES)[number];

export const AUTOMATION_EVENT_TYPES = [
  "loan_requested",
  "loan_approved",
  "loan_declined",
  "loan_cancelled",
  "loan_returned",
  "overdue_reminder",
] as const;
export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

export const AUTOMATION_ACTIVITY_STATUSES = ["pending", "sent", "failed"] as const;
export type AutomationActivityStatus = (typeof AUTOMATION_ACTIVITY_STATUSES)[number];

export const AUTOMATION_RECIPIENT_ROLES = ["lender", "borrower"] as const;
export type AutomationRecipientRole = (typeof AUTOMATION_RECIPIENT_ROLES)[number];

export const AUDIT_ACTOR_ROLES = ["user", "admin", "system"] as const;
export type AuditActorRole = (typeof AUDIT_ACTOR_ROLES)[number];

export const AUDIT_TARGET_TYPES = ["user", "listing", "loan"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export const AUDIT_ACTIONS = [
  "user.role_changed",
  "user.trusted_lender_toggled",
  "user.deleted",
  "listing.created",
  "listing.updated",
  "listing.archived",
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.returned",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const DOMAIN_LIMITS = {
  MAX_LOAN_DURATION_DAYS: 30,
  MAX_LISTING_NAME_LENGTH: 100,
  MAX_LISTING_DESCRIPTION_LENGTH: 500,
  MAX_LOAN_NOTE_LENGTH: 300,
  MAX_REASON_LENGTH: 300,
  MAX_LISTING_IMAGES: 5,
  MAX_PAGE_SIZE: 50,
} as const;
