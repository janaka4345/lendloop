"use client";

import { useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Component, type ReactNode } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AppErrorData } from "../../../../convex/lib/errors";
import { useHasConvexProvider } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ListingForm } from "./listing-form";

interface ErrorBoundaryState {
  error: unknown;
}

class EditListingErrorBoundary extends Component<
  { listingId: string; children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    let code: AppErrorData["code"] | null = null;
    let message = "Unable to load this Listing for editing.";
    if (this.state.error instanceof ConvexError) {
      const data = this.state.error.data as Partial<AppErrorData> | undefined;
      if (data?.code) code = data.code;
      if (data?.message) message = data.message;
    }

    const isForbidden = code === "FORBIDDEN";
    const isNotFound = code === "NOT_FOUND";

    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <AlertTitle>
                {isForbidden
                  ? "Permission denied"
                  : isNotFound
                    ? "Listing not found"
                    : "Unable to edit Listing"}
              </AlertTitle>
              <AlertDescription>
                {isForbidden ? "Only the Lender who created this Listing can edit it." : message}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        <div className="flex flex-wrap gap-3">
          {isForbidden ? (
            <Button asChild variant="outline">
              <Link href={`/listings/${this.props.listingId}`}>Back to Listing</Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/listings">Back to All Tools</Link>
          </Button>
        </div>
      </div>
    );
  }
}

function LiveEditListingContent({ listingId }: { listingId: Id<"listings"> }) {
  const listing = useQuery(api.listings.queries.getListingForEdit, { listingId });

  if (listing === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="bg-muted h-10 w-full animate-pulse rounded-md" />
        <div className="bg-muted h-10 w-full animate-pulse rounded-md" />
        <div className="bg-muted h-28 w-full animate-pulse rounded-md" />
      </div>
    );
  }

  return (
    <ListingForm
      mode="edit"
      initialValues={{
        listingId: listing._id,
        name: listing.name,
        category: listing.category,
        condition: listing.condition,
        description: listing.description,
        images: listing.images,
      }}
    />
  );
}

export function EditListingView({ listingId }: { listingId: string }) {
  const hasConvex = useHasConvexProvider();
  if (!hasConvex) {
    return (
      <div className="border-border bg-card rounded-xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Connect Clerk and Convex to edit Listings.</p>
      </div>
    );
  }

  return (
    <EditListingErrorBoundary listingId={listingId}>
      <LiveEditListingContent listingId={listingId as Id<"listings">} />
    </EditListingErrorBoundary>
  );
}
