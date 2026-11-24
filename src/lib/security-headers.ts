export interface SecurityHeadersEnv {
  NODE_ENV?: string;
  APP_URL?: string;
  CONVEX_URL?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_FRONTEND_API_URL?: string;
  SENTRY_DSN?: string;
}

export interface SecurityHeadersOptions {
  isHttpsRequest?: boolean;
}

function parseOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl || rawUrl.trim().length === 0) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(httpOrigin: string): string {
  if (httpOrigin.startsWith("https://")) {
    return `wss://${httpOrigin.slice("https://".length)}`;
  }
  if (httpOrigin.startsWith("http://")) {
    return `ws://${httpOrigin.slice("http://".length)}`;
  }
  return httpOrigin;
}

function decodeBase64(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof Buffer !== "undefined") {
      return Buffer.from(normalized, "base64").toString("utf8");
    }
    return atob(normalized);
  } catch {
    return null;
  }
}

export function deriveClerkOrigin(env: SecurityHeadersEnv): string | null {
  const explicit = parseOrigin(env.CLERK_FRONTEND_API_URL);
  if (explicit) return explicit;

  const pk = env.CLERK_PUBLISHABLE_KEY?.trim();
  if (!pk) return null;

  const prefix = pk.startsWith("pk_test_")
    ? "pk_test_"
    : pk.startsWith("pk_live_")
      ? "pk_live_"
      : null;
  if (!prefix) return null;

  const decoded = decodeBase64(pk.slice(prefix.length));
  if (!decoded) return null;

  const host = decoded.replace(/\$+$/, "").trim();
  if (!host || /\s/.test(host)) return null;

  return parseOrigin(`https://${host}`);
}

export function buildContentSecurityPolicy(env: SecurityHeadersEnv): string {
  const clerkOrigin = deriveClerkOrigin(env);
  const convexOrigin = parseOrigin(env.CONVEX_URL);
  const convexWsOrigin = convexOrigin ? toWebSocketOrigin(convexOrigin) : null;
  const sentryOrigin = parseOrigin(env.SENTRY_DSN);

  const isDev = env.NODE_ENV === "development";

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    ...(clerkOrigin ? [clerkOrigin] : []),
  ];

  const connectSrc = [
    "'self'",
    ...(clerkOrigin ? [clerkOrigin] : []),
    ...(convexOrigin ? [convexOrigin] : []),
    ...(convexWsOrigin ? [convexWsOrigin] : []),
    ...(sentryOrigin ? [sentryOrigin] : []),
  ];

  const imgSrc = [
    "'self'",
    "blob:",
    "data:",
    ...(convexOrigin ? [convexOrigin] : []),
    ...(clerkOrigin ? [clerkOrigin] : []),
  ];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return directives.join("; ");
}

export function buildSecurityHeaders(
  env: SecurityHeadersEnv,
  options: SecurityHeadersOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": buildContentSecurityPolicy(env),
  };

  const appOrigin = parseOrigin(env.APP_URL);
  const isHttpsApp = appOrigin?.startsWith("https://") ?? false;
  const isHttpsRequest = options.isHttpsRequest ?? false;
  const isProduction = env.NODE_ENV === "production";

  if (isProduction && (isHttpsApp || isHttpsRequest)) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}
