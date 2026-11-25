import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { REDACTED, redactText, redactValue } from "@/domain/redaction";

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-n8n-service-token",
  "x-api-key",
  "svix-signature",
  "svix-id",
  "svix-timestamp",
]);

function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_HEADER_KEYS.has(lower)) return true;
  return (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("auth") ||
    lower.includes("cookie") ||
    lower.includes("api-key") ||
    lower.includes("signature")
  );
}

export function resolveSentryDsn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const next: Breadcrumb = { ...breadcrumb };
  if (typeof next.message === "string") {
    next.message = redactText(next.message);
  }
  if (next.data && typeof next.data === "object") {
    next.data = redactValue(next.data) as Record<string, unknown>;
  }
  return next;
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const next: ErrorEvent = { ...event };

  if (typeof next.message === "string") {
    next.message = redactText(next.message);
  }

  if (next.user) {
    next.user = next.user.id !== undefined ? { id: next.user.id } : undefined;
  }

  if (next.request) {
    const req = { ...next.request };
    delete req.cookies;

    if (typeof req.url === "string") {
      req.url = redactText(req.url);
    }
    if (typeof req.query_string === "string") {
      req.query_string = redactText(req.query_string);
    } else if (req.query_string && typeof req.query_string === "object") {
      req.query_string = redactValue(req.query_string) as typeof req.query_string;
    }

    if (req.headers) {
      const cleanHeaders: Record<string, string> = {};
      for (const [headerName, headerValue] of Object.entries(req.headers)) {
        cleanHeaders[headerName] = isSensitiveHeader(headerName)
          ? REDACTED
          : redactText(String(headerValue));
      }
      req.headers = cleanHeaders;
    }

    if (req.data !== undefined) {
      req.data = redactValue(req.data);
    }

    next.request = req;
  }

  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((ex) => ({
        ...ex,
        ...(typeof ex.value === "string" ? { value: redactText(ex.value) } : {}),
      })),
    };
  }

  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => scrubSentryBreadcrumb(crumb));
  }

  if (next.extra) {
    next.extra = redactValue(next.extra) as Record<string, unknown>;
  }

  if (next.contexts) {
    next.contexts = redactValue(next.contexts) as typeof next.contexts;
  }

  if (next.tags) {
    const cleanTags: Record<
      string,
      string | number | boolean | bigint | symbol | null | undefined
    > = {};
    for (const [key, value] of Object.entries(next.tags)) {
      cleanTags[key] = typeof value === "string" ? redactText(value) : value;
    }
    next.tags = cleanTags;
  }

  return next;
}

export interface SentryInitParams {
  dsn: string | null | undefined;
  environment?: string | null;
  nodeEnv?: string;
}

export interface LendLoopSentryOptions {
  dsn: string;
  enabled: true;
  sendDefaultPii: false;
  environment: string;
  tracesSampleRate: number;
  beforeSend: (event: ErrorEvent) => ErrorEvent;
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => Breadcrumb;
}

export function buildSentryInitOptions(params: SentryInitParams): LendLoopSentryOptions | null {
  const dsn = resolveSentryDsn(params.dsn);
  if (!dsn) return null;

  const environment = params.environment?.trim() || params.nodeEnv || "local";
  const tracesSampleRate = params.nodeEnv === "development" ? 1.0 : 0.1;

  return {
    dsn,
    enabled: true,
    sendDefaultPii: false,
    environment,
    tracesSampleRate,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  };
}

export function initServerSentry(): void {
  const options = buildSentryInitOptions({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
  });
  if (options) {
    Sentry.init(options);
  }
}
