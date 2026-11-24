"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { isSyntheticClerkKey, type PublicRuntimeConfig } from "@/lib/runtime-config";

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
  const convexUrl = config?.convexUrl;
  const convexClient = useMemo(() => {
    if (!convexUrl) return null;
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!config || !convexClient || isSyntheticClerkKey(config.clerkPublishableKey)) {
    return <>{children}</>;
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
        <AuthenticatedUserSync />
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
