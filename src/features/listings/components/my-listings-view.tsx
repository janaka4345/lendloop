"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AppErrorData } from "../../../../convex/lib/errors";
import { useHasConvexProvider, useSyncedCurrentUser } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ModalDialog } from "@/components/ui/dialog";
import {
  DOMAIN_LIMITS,
  type ListingAvailability,
  type ListingCategory,
  type ListingCondition,
} from "@/domain/types";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, CONDITION_LABELS } from "../schema";
import { ListingMediaCarousel } from "./listing-media-carousel";

interface MyListingItem {
  _id: Id<"listings">;
  name: string;
  category: ListingCategory;
  condition: ListingCondition;
  description: string;
  availability: ListingAvailability;
  images: Array<{ url: string }>;
  pendingRequestCount: number;
  hasActiveApprovedLoan: boolean;
  createdAt: number;
  updatedAt: number;
}

function LiveMyListingsView() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousItems, setPreviousItems] = useState<MyListingItem[]>([]);
  const [targetListing, setTargetListing] = useState<MyListingItem | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const archiveListing = useMutation(api.listings.mutations.archiveListing);

  const currentUser = useSyncedCurrentUser();
  const page = useQuery(
    api.listings.queries.listMyListings,
    currentUser
      ? {
          cursor,
          limit: DOMAIN_LIMITS.MAX_PAGE_SIZE,
        }
      : "skip",
  );

  const items = useMemo(() => {
    if (cursor === null) {
      return page?.items ?? [];
    }
    const currentItems = page?.items ?? [];
    const seen = new Set(previousItems.map((item) => item._id));
    return [...previousItems, ...currentItems.filter((item) => !seen.has(item._id))];
  }, [cursor, page, previousItems]);

  const handleLoadMore = () => {
    if (!page || page.isDone) return;
    setPreviousItems(items);
    setCursor(page.continueCursor);
  };

  const handleConfirmArchive = async () => {
    if (!targetListing) return;
    setIsArchiving(true);
    try {
      const result = await archiveListing({ listingId: targetListing._id });
      toast.success(
        result.autoDeclinedCount > 0
          ? `Listing deleted and ${result.autoDeclinedCount} pending request(s) declined.`
          : "Listing deleted.",
      );
      setTargetListing(null);
      setCursor(null);
      setPreviousItems([]);
    } catch (error) {
      let message = "Unable to delete Listing.";
      if (error instanceof ConvexError) {
        const data = error.data as Partial<AppErrorData> | undefined;
        if (data?.message) message = data.message;
      }
      toast.error(message);
    } finally {
      setIsArchiving(false);
    }
  };

  const isInitialLoading = page === undefined && items.length === 0;
  const isLoadingMore = page === undefined && cursor !== null;

  if (isInitialLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="overflow-hidden">
            <div className="bg-muted aspect-[4/3] w-full animate-pulse" />
            <CardHeader className="space-y-2 p-4">
              <div className="bg-muted h-5 w-3/4 animate-pulse rounded" />
              <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="border-border bg-card flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
        <Wrench className="text-muted-foreground h-9 w-9 opacity-60" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">You haven&apos;t listed any tools yet</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            Share a tool with your neighborhood and manage borrow requests in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/listings/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            List your first tool
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((listing) => (
          <Card key={listing._id} className="flex flex-col overflow-hidden">
            <ListingMediaCarousel
              images={listing.images}
              name={listing.name}
              category={listing.category}
            />
            <CardHeader className="space-y-2 p-4 pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="line-clamp-1 text-base font-semibold">
                  <Link href={`/listings/${listing._id}`} className="hover:underline">
                    {listing.name}
                  </Link>
                </CardTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    listing.availability === "Available"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800",
                  )}
                >
                  {listing.availability}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{CATEGORY_LABELS[listing.category]}</Badge>
                <Badge variant="outline">{CONDITION_LABELS[listing.condition]}</Badge>
                {listing.pendingRequestCount > 0 ? (
                  <Badge variant="secondary" className="bg-sky-50 text-sky-900">
                    {listing.pendingRequestCount} pending{" "}
                    {listing.pendingRequestCount === 1 ? "request" : "requests"}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex-1 px-4 pt-1 pb-3">
              <p className="text-muted-foreground line-clamp-2 text-sm">{listing.description}</p>
            </CardContent>
            <CardFooter className="border-border flex items-center justify-between gap-2 border-t px-4 py-3">
              <Button asChild variant="outline" size="sm">
                <Link href={`/listings/${listing._id}/edit`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setTargetListing(listing)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {page && !page.isDone ? (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="outline" disabled={isLoadingMore} onClick={handleLoadMore}>
            {isLoadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading more...
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      ) : null}

      <ModalDialog
        open={targetListing !== null}
        onOpenChange={(open) => {
          if (!open && !isArchiving) {
            setTargetListing(null);
          }
        }}
        title={
          targetListing?.hasActiveApprovedLoan
            ? "Cannot delete Listing with an active Loan"
            : `Delete "${targetListing?.name ?? ""}"?`
        }
        description={
          targetListing?.hasActiveApprovedLoan
            ? "This Listing currently has an unreturned approved Loan. Please mark the Loan as returned on Incoming Requests before deleting this Listing."
            : "Deleting archives this Listing from LendLoop and permanently removes its uploaded photos."
        }
        footer={
          targetListing?.hasActiveApprovedLoan ? (
            <Button type="button" onClick={() => setTargetListing(null)}>
              Got it
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isArchiving}
                onClick={() => setTargetListing(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isArchiving}
                onClick={handleConfirmArchive}
              >
                {isArchiving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Deleting...
                  </>
                ) : (
                  "Delete Listing"
                )}
              </Button>
            </>
          )
        }
      >
        {targetListing &&
        !targetListing.hasActiveApprovedLoan &&
        targetListing.pendingRequestCount > 0 ? (
          <Alert variant="warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <AlertTitle>Open pending requests will be declined</AlertTitle>
                <AlertDescription>
                  Deleting this Listing will automatically decline{" "}
                  <strong>{targetListing.pendingRequestCount}</strong> pending borrow{" "}
                  {targetListing.pendingRequestCount === 1 ? "request" : "requests"}.
                </AlertDescription>
              </div>
            </div>
          </Alert>
        ) : null}
      </ModalDialog>
    </div>
  );
}

export function MyListingsView() {
  const hasConvex = useHasConvexProvider();
  if (!hasConvex) {
    return (
      <div className="border-border bg-card rounded-xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Connect Clerk and Convex to manage your Listings.
        </p>
      </div>
    );
  }
  return <LiveMyListingsView />;
}
