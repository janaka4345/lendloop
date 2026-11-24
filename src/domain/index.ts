/**
 * Pure domain module placeholder for Commit-1 bootstrap.
 * Domain rules (Loan state machine, UTC calendar/overlap, Availability/Overdue,
 * retry backoff, PII redaction) are implemented in Slice 2.
 */
export const DOMAIN_SLICES = ["listings", "lending", "users", "automation", "audit"] as const;

export type DomainSlice = (typeof DOMAIN_SLICES)[number];
