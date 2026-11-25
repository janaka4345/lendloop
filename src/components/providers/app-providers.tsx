"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Toaster } from "sonner";
import { api } from "../../../convex/_generated/api";
import { isSyntheticClerkKey, type PublicRuntimeConfig } from "@/lib/runtime-config";
import { buildSentryInitOptions } from "@/lib/sentry";

const ConvexAvailableContext = createContext<boolean>(false);

export function useHasConvexProvider(): boolean {
  return useContext(ConvexAvailableContext);
}

function AuthenticatedUserSync() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const syncCurrentUser = useMutation(api.users.mutations.syncCurrentUser);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      syncedRef.current = false;
      return;
    }
    if (isLoading || syncedRef.current) {
      return;
    }

    syncedRef.current = true;
    void syncCurrentUser({}).catch(() => {
      syncedRef.current = false;
    });
  }, [isAuthenticated, isLoading, syncCurrentUser]);

  return null;
}

export function AppProviders({
  config,
  children,
}: {
  config: PublicRuntimeConfig | null;
  children: ReactNode;
}) {
  useEffect(() => {
    if (Sentry.isInitialized()) return;
    const options = buildSentryInitOptions({
      dsn: config?.sentryDsn,
      environment: config?.environment,
      nodeEnv: process.env.NODE_ENV,
    });
    if (options) {
      Sentry.init(options);
    }
  }, [config?.sentryDsn, config?.environment]);

  const convexUrl = config?.convexUrl;
  const convexClient = useMemo(() => {
    if (!convexUrl) return null;
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!config || !convexClient || isSyntheticClerkKey(config.clerkPublishableKey)) {
    return (
      <ConvexAvailableContext.Provider value={false}>
        {children}
        <Toaster richColors position="bottom-right" />
      </ConvexAvailableContext.Provider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={config.clerkPublishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/listings"
      signUpFallbackRedirectUrl="/listings"
    >
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        <ConvexAvailableContext.Provider value={true}>
          <AuthenticatedUserSync />
          {children}
          <Toaster richColors position="bottom-right" />
        </ConvexAvailableContext.Provider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
