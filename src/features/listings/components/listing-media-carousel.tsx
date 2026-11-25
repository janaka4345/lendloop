"use client";

import useEmblaCarousel from "embla-carousel-react";
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
import { useCallback, useEffect, useState, type MouseEvent } from "react";
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

export interface ListingMediaCarouselProps {
  images: ReadonlyArray<{ url: string }>;
  name: string;
  category: ListingCategory;
  className?: string;
}

/**
 * Click-safe 4:3 photo carousel for Public `/` and authenticated *All Tools* cards.
 * - 0 photos: muted Category icon placeholder
 * - 1 photo: static unoptimized image
 * - 2–5 photos: Embla Carousel with prev/next arrows & dots that stop click propagation
 */
export function ListingMediaCarousel({
  images,
  name,
  category,
  className,
}: ListingMediaCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    };
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi]);

  const handlePrev = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      emblaApi?.scrollPrev();
    },
    [emblaApi],
  );

  const handleNext = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      emblaApi?.scrollNext();
    },
    [emblaApi],
  );

  const handleDotClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, index: number) => {
      event.preventDefault();
      event.stopPropagation();
      emblaApi?.scrollTo(index);
    },
    [emblaApi],
  );

  if (images.length === 0) {
    const CategoryIcon = CATEGORY_ICONS[category];
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 overflow-hidden",
          className,
        )}
      >
        <CategoryIcon className="h-10 w-10 opacity-60" aria-hidden="true" />
        <span className="text-xs font-medium tracking-wide uppercase opacity-75">
          {CATEGORY_LABELS[category]}
        </span>
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className={cn("bg-muted relative aspect-[4/3] w-full overflow-hidden", className)}>
        <Image
          src={images[0]!.url}
          alt={name}
          fill
          unoptimized
          loading="lazy"
          decoding="async"
          className="object-cover"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      </div>
    );
  }

  return (
    <div
      className={cn("bg-muted group relative aspect-[4/3] w-full overflow-hidden", className)}
      role="region"
      aria-roledescription="carousel"
      aria-label={`${name} photos`}
    >
      <div className="h-full w-full overflow-hidden" ref={emblaRef}>
        <div className="flex h-full">
          {images.map((img, index) => (
            <div key={`${img.url}-${index}`} className="relative h-full min-w-0 flex-[0_0_100%]">
              <Image
                src={img.url}
                alt={`${name} photo ${index + 1} of ${images.length}`}
                fill
                unoptimized
                loading="lazy"
                decoding="async"
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={handlePrev}
        aria-label="Previous photo"
        className="focus-visible:ring-ring absolute top-1/2 left-2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/65 text-white shadow transition-opacity hover:bg-slate-950/85 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={handleNext}
        aria-label="Next photo"
        className="focus-visible:ring-ring absolute top-1/2 right-2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/65 text-white shadow transition-opacity hover:bg-slate-950/85 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>

      <div
        className="absolute right-0 bottom-2 left-0 z-10 flex items-center justify-center gap-1.5"
        role="tablist"
        aria-label="Choose a photo"
      >
        {images.map((_, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === selectedIndex}
            aria-label={`View photo ${index + 1}`}
            onClick={(event) => handleDotClick(event, index)}
            className={cn(
              "h-2 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
              index === selectedIndex ? "w-5 bg-white" : "w-2 bg-white/60 hover:bg-white/85",
            )}
          />
        ))}
      </div>
    </div>
  );
}
