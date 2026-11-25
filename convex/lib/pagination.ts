import { DOMAIN_LIMITS } from "../../src/domain/types";

export function clampPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DOMAIN_LIMITS.MAX_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit), 1), DOMAIN_LIMITS.MAX_PAGE_SIZE);
}
