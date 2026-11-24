export const RETRY_DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
} as const;

export interface RetryBackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
}

export function computeRetryDelayMs(attempt: number, options: RetryBackoffOptions = {}): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }

  const baseDelayMs = options.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs;
  const jitterRatio = options.jitterRatio ?? RETRY_DEFAULTS.jitterRatio;
  const random = options.random ?? Math.random;

  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitterMultiplier = 1 + (random() * 2 - 1) * jitterRatio;
  const withJitter = Math.round(exponential * jitterMultiplier);

  return Math.min(maxDelayMs, Math.max(0, withJitter));
}

export function shouldRetryHttpStatus(
  status: number,
  attempt: number,
  maxAttempts: number = RETRY_DEFAULTS.maxAttempts,
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  if (status === 0 || status === 408 || status === 429) {
    return true;
  }
  return status >= 500;
}
