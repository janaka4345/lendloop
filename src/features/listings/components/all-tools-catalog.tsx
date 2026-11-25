"use client";

import { useQuery } from "convex/react";
import { BadgeCheck, Loader2, Plus, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useHasConvexProvider } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DOMAIN_LIMITS,
  LISTING_CATEGORIES,
  type ListingAvailability,
  type ListingCategory,
  type ListingCondition,
} from "@/domain/types";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, CONDITION_LABELS } from "../schema";
import { ListingMediaCarousel } from "./listing-media-carousel";

interface CatalogListingItem {
  _id: Id<"listings">;
  name: string;
  category: ListingCategory;
  condition: ListingCondition;
  availability: ListingAvailability;
  images: Array<{ url: string }>;
  lender: {
    id: Id<"users">;
    displayName: string;
    trustedLender: boolean;
  };
  createdAt: number;
}

function LiveAllToolsCatalog() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ListingCategory | "all">("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousItems, setPreviousItems] = useState<CatalogListingItem[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextSearch = searchInput.trim();
      setDebouncedSearch(nextSearch);
      setCursor(null);
      setPreviousItems([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const page = useQuery(api.listings.queries.listCatalogListings, {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(selectedCategory !== "all" ? { category: selectedCategory } : {}),
    ...(availableOnly ? { availableOnly: true } : {}),
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

  const hasActiveFilters =
    debouncedSearch.length > 0 || selectedCategory !== "all" || availableOnly;
  const isInitialLoading = page === undefined && items.length === 0;
  const isLoadingMore = page === undefined && cursor !== null;

  const handleCategoryChange = (category: ListingCategory | "all") => {
    setSelectedCategory(category);
    setCursor(null);
    setPreviousItems([]);
  };

  const handleToggleAvailableOnly = () => {
    setAvailableOnly((prev) => !prev);
    setCursor(null);
    setPreviousItems([]);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedCategory("all");
    setAvailableOnly(false);
    setCursor(null);
    setPreviousItems([]);
  };

  const handleLoadMore = () => {
    if (!page || page.isDone) return;
    setPreviousItems(items);
    setCursor(page.continueCursor);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-md">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search tools by name..."
              aria-label="Search tools by name"
              className="pl-9"
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={availableOnly}
            onClick={handleToggleAvailableOnly}
            className={cn(
              "inline-flex w-fit items-center gap-2.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              availableOnly
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-border bg-background text-foreground hover:bg-secondary/60",
            )}
          >
            <span
              className={cn(
                "inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                availableOnly ? "bg-emerald-600" : "bg-slate-300",
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "h-3 w-3 rounded-full bg-white shadow transition-transform",
                  availableOnly ? "translate-x-3" : "translate-x-0",
                )}
              />
            </span>
            Available today only
          </button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by Category">
          <button
            type="button"
            onClick={() => handleCategoryChange("all")}
            aria-pressed={selectedCategory === "all"}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              selectedCategory === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            All
          </button>
          {LISTING_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => handleCategoryChange(category)}
              aria-pressed={selectedCategory === category}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                selectedCategory === category
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
      </div>

      {isInitialLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx} className="overflow-hidden">
              <div className="bg-muted aspect-[4/3] w-full animate-pulse" />
              <CardHeader className="space-y-2 p-4">
                <div className="bg-muted h-5 w-3/4 animate-pulse rounded" />
                <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : items.length === 0 && (!page || page.isDone) ? (
        <div className="border-border bg-card flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
          <Wrench className="text-muted-foreground h-9 w-9 opacity-60" aria-hidden="true" />
          {hasActiveFilters ? (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">No Listings match your filters</h2>
                <p className="text-muted-foreground max-w-md text-sm">
                  Try clearing your search or category filters to see all active tools.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handleClearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">No tools listed yet</h2>
                <p className="text-muted-foreground max-w-md text-sm">
                  Be the first neighbor to share a tool on LendLoop.
                </p>
              </div>
              <Button asChild>
                <Link href="/listings/new">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  List your first tool
                </Link>
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((listing) => (
              <Link
                key={listing._id}
                href={`/listings/${listing._id}`}
                className="group focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
                  <ListingMediaCarousel
                    images={listing.images}
                    name={listing.name}
                    category={listing.category}
                  />
                  <CardHeader className="space-y-2.5 p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-1 text-base font-semibold">
                        {listing.name}
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
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pt-1 pb-4">
                    <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
                      <span>Lender:</span>
                      <span className="text-foreground font-medium">
                        {listing.lender.displayName}
                      </span>
                      {listing.lender.trustedLender ? (
                        <Badge variant="secondary" className="gap-1 bg-sky-50 text-sky-800">
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Trusted Lender
                        </Badge>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {page && !page.isDone ? (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isLoadingMore}
                onClick={handleLoadMore}
              >
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
        </>
      )}
    </div>
  );
}

export function AllToolsCatalog() {
  const hasConvex = useHasConvexProvider();
  if (!hasConvex) {
    return (
      <div className="border-border bg-card rounded-xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Connect Clerk and Convex to browse live neighborhood Listings.
        </p>
      </div>
    );
  }
  return <LiveAllToolsCatalog />;
}
