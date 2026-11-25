import * as Sentry from "@sentry/nextjs";

/**
 * Browser Sentry initialization is deferred to AppProviders using server-injected
 * runtime config (`config.sentryDsn`) so zero DSNs or NEXT_PUBLIC_* vars are baked
 * at container build time. When Sentry is not initialized, router transition capture
 * is a clean no-op.
 */
export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart = (...args) => {
  if (!Sentry.isInitialized()) {
    return;
  }
  return Sentry.captureRouterTransitionStart(...args);
};
