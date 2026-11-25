"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { Loader2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SignInCtaButton } from "@/components/auth/sign-in-cta-button";
import { useHasConvexProvider } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DOMAIN_LIMITS, type ListingCategory } from "@/domain/types";
import { ListingMediaCarousel } from "./listing-media-carousel";
import { CATEGORY_LABELS } from "../schema";

interface PublicListingItem {
  _id: Id<"listings">;
  name: string;
  category: ListingCategory;
  images: Array<{ url: string }>;
}

function LivePublicListingsGrid() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousItems, setPreviousItems] = useState<PublicListingItem[]>([]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/listings");
    }
  }, [authLoading, isAuthenticated, router]);

  const page = useQuery(api.listings.queries.listPublicAvailableListings, {
    cursor,
    limit: DOMAIN_LIMITS.MAX_PAGE_SIZE,
  });

  const items = useMemo(() => {
    if (cursor === null) {
      return page?.items ?? [];
    }
    const currentItems = page?.items ?? [];
    const seen = new Set(previousItems.map((item) => item._id));
    return [...previousItems, ...currentItems.filter((item) => !seen.has(item._id))];
  }, [cursor, page, previousItems]);

  const isLoadingFirstPage = page === undefined && items.length === 0;
  const isLoadingMore = page === undefined && cursor !== null;

  const handleLoadMore = () => {
    if (!page || page.isDone) return;
    setPreviousItems(items);
    setCursor(page.continueCursor);
  };

  if (isLoadingFirstPage) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="overflow-hidden">
            <div className="bg-muted aspect-[4/3] w-full animate-pulse" />
            <CardHeader className="space-y-2">
              <div className="bg-muted h-5 w-2/3 animate-pulse rounded" />
              <div className="bg-muted h-5 w-24 animate-pulse rounded" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="border-border bg-card flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <Wrench className="text-muted-foreground h-8 w-8 opacity-70" aria-hidden="true" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold">No Available Listings right now</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            Sign in to browse the full neighborhood catalog or share your first tool with neighbors.
          </p>
        </div>
        <SignInCtaButton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((listing) => (
          <Card key={listing._id} className="overflow-hidden transition-shadow hover:shadow-md">
            <ListingMediaCarousel
              images={listing.images}
              name={listing.name}
              category={listing.category}
            />
            <CardHeader className="space-y-2 p-4">
              <CardTitle className="line-clamp-1 text-base font-semibold">{listing.name}</CardTitle>
              <div>
                <Badge variant="secondary">{CATEGORY_LABELS[listing.category]}</Badge>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      {page && !page.isDone ? (
        <div className="flex justify-center">
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
    </div>
  );
}

export function PublicListingsSection() {
  const hasConvex = useHasConvexProvider();

  return (
    <section aria-labelledby="available-listings-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 id="available-listings-heading" className="text-2xl font-semibold tracking-tight">
            Available Tools Today
          </h2>
          <p className="text-muted-foreground text-sm">
            Preview tools ready to borrow today. Lender details stay private until you sign in.
          </p>
        </div>
      </div>

      {hasConvex ? (
        <LivePublicListingsGrid />
      ) : (
        <div className="border-border bg-card flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <Wrench className="text-muted-foreground h-8 w-8 opacity-70" aria-hidden="true" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Available neighborhood tools appear here</h3>
            <p className="text-muted-foreground max-w-md text-sm">
              Sign in to browse all Listings, check Availability, and request to borrow tools.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
