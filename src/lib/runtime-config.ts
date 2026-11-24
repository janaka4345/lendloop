import { z } from "zod";

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "must be set")
  .refine(isHttpUrl, "must be a valid http(s) URL");

const optionalHttpUrlSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .refine((value) => !value || isHttpUrl(value), "must be a valid http(s) URL");

function clerkKeySchema(testPrefix: string, livePrefix: string) {
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        (value.startsWith(testPrefix) && value.length > testPrefix.length) ||
        (value.startsWith(livePrefix) && value.length > livePrefix.length),
      `must start with ${testPrefix} or ${livePrefix}`,
    );
}

const runtimeConfigSchema = z.object({
  APP_URL: httpUrlSchema,
  CONVEX_URL: httpUrlSchema,
  CLERK_PUBLISHABLE_KEY: clerkKeySchema("pk_test_", "pk_live_"),
  CLERK_SECRET_KEY: clerkKeySchema("sk_test_", "sk_live_"),
  CLERK_FRONTEND_API_URL: optionalHttpUrlSchema,
  SENTRY_DSN: optionalHttpUrlSchema,
  APP_ENV: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : "local")),
});

export interface PublicRuntimeConfig {
  appUrl: string;
  convexUrl: string;
  clerkPublishableKey: string;
  sentryDsn: string | null;
  environment: string;
}

export type RuntimeConfigValidationResult =
  | {
      ok: true;
      publicConfig: PublicRuntimeConfig;
    }
  | {
      ok: false;
      errors: string[];
    };

export function validateRuntimeConfig(
  env: Record<string, string | undefined>,
): RuntimeConfigValidationResult {
  const parsed = runtimeConfigSchema.safeParse({
    APP_URL: env.APP_URL ?? "",
    CONVEX_URL: env.CONVEX_URL ?? "",
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY ?? "",
    CLERK_SECRET_KEY: env.CLERK_SECRET_KEY ?? "",
    CLERK_FRONTEND_API_URL: env.CLERK_FRONTEND_API_URL,
    SENTRY_DSN: env.SENTRY_DSN,
    APP_ENV: env.APP_ENV,
  });

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".") || "config";
      return `${field}: ${issue.message}`;
    });
    return { ok: false, errors };
  }

  return {
    ok: true,
    publicConfig: {
      appUrl: parsed.data.APP_URL,
      convexUrl: parsed.data.CONVEX_URL,
      clerkPublishableKey: parsed.data.CLERK_PUBLISHABLE_KEY,
      sentryDsn: parsed.data.SENTRY_DSN ?? null,
      environment: parsed.data.APP_ENV,
    },
  };
}
