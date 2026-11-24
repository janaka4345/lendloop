export const REDACTED = "[REDACTED]";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SECRET_PREFIX_PATTERN = /\b(?:sk_live|sk_test|pk_live|pk_test|whsec|ghp|gho)_[A-Za-z0-9_-]+/g;

const SENSITIVE_KEYS = new Set([
  "email",
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "externalid",
  "external_id",
  "clerkid",
  "clerk_id",
  "displayname",
  "display_name",
  "phone",
  "address",
  "ip",
  "useragent",
  "user_agent",
]);

const MAX_REDACTION_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("email")
  );
}

export function redactText(input: string): string {
  return input
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(SECRET_PREFIX_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED);
}

export function redactValue(value: unknown, depth: number = 0): unknown {
  if (depth > MAX_REDACTION_DEPTH) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1);
  }
  return result;
}

export type AuditMetadataValue = string | number | boolean | null;
export type SafeAuditMetadata = Record<string, AuditMetadataValue>;

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): SafeAuditMetadata | undefined {
  if (!metadata) return undefined;

  const clean: SafeAuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveKey(key) || value === undefined) {
      continue;
    }
    if (typeof value === "string") {
      clean[key] = redactText(value);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      clean[key] = value;
    }
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

export interface StructuredLogEntry {
  level: "info" | "warn" | "error";
  event: string;
  code?: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export function formatStructuredLog(entry: StructuredLogEntry): string {
  const payload = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.context ? { context: redactValue(entry.context) } : {}),
  };
  return JSON.stringify(payload);
}
