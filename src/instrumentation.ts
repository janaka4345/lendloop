import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn } from "@/lib/sentry";

export async function register() {
  if (!resolveSentryDsn(process.env.SENTRY_DSN)) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (!resolveSentryDsn(process.env.SENTRY_DSN)) {
    return;
  }
  return Sentry.captureRequestError(...args);
};
