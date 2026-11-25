"use client";

import {
  Car,
  ChevronLeft,
  ChevronRight,
  Hammer,
  Sparkles,
  Sprout,
  Tent,
  Utensils,
  Wrench,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { ListingCategory } from "@/domain/types";
import { CATEGORY_LABELS } from "@/features/listings/schema";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<ListingCategory, typeof Wrench> = {
  power_tools: Zap,
  garden: Sprout,
  kitchen: Utensils,
  camping: Tent,
  hand_tools: Hammer,
  automotive: Car,
  cleaning: Sparkles,
  other: Wrench,
};

export interface ListingHeroGalleryProps {
  images: ReadonlyArray<{ url: string }>;
  name: string;
  category: ListingCategory;
}

export function ListingHeroGallery({ images, name, category }: ListingHeroGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const safeIndex = images.length > 0 ? Math.min(activeIndex, images.length - 1) : 0;

  if (images.length === 0) {
    const CategoryIcon = CATEGORY_ICONS[category];
    return (
      <div className="bg-muted text-muted-foreground border-border flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-xl border">
        <CategoryIcon className="h-14 w-14 opacity-55" aria-hidden="true" />
        <span className="text-xs font-medium tracking-wider uppercase opacity-75">
          {CATEGORY_LABELS[category]}
        </span>
      </div>
    );
  }

  const activeImage = images[safeIndex]!;

  return (
    <div className="space-y-3">
      <div className="bg-muted border-border relative aspect-[4/3] w-full overflow-hidden rounded-xl border">
        <Image
          src={activeImage.url}
          alt={`${name} photo ${safeIndex + 1} of ${images.length}`}
          fill
          unoptimized
          decoding="async"
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 60vw"
        />

        {images.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setActiveIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1))}
              className="focus-visible:ring-ring absolute top-1/2 left-3 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/65 text-white shadow transition-colors hover:bg-slate-950/85 focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setActiveIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1))}
              className="focus-visible:ring-ring absolute top-1/2 right-3 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/65 text-white shadow transition-colors hover:bg-slate-950/85 focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="absolute right-3 bottom-3 rounded-full bg-slate-950/70 px-2.5 py-0.5 text-xs font-medium text-white">
              {safeIndex + 1} / {images.length}
            </span>
          </>
        ) : null}
      </div>

      {images.length > 1 ? (
        <div
          className="grid grid-cols-5 gap-2"
          role="tablist"
          aria-label="Listing photo thumbnails"
        >
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === safeIndex}
              aria-label={`View photo ${index + 1}`}
              onClick={() => setActiveIndex(index)}
              className={cn(
                "bg-muted relative aspect-[4/3] overflow-hidden rounded-lg border transition-all focus-visible:ring-2 focus-visible:outline-none",
                index === safeIndex
                  ? "border-primary ring-primary/30 ring-2"
                  : "border-border opacity-75 hover:opacity-100",
              )}
            >
              <Image
                src={image.url}
                alt={`${name} thumbnail ${index + 1}`}
                fill
                unoptimized
                loading="lazy"
                decoding="async"
                className="object-cover"
                sizes="120px"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
