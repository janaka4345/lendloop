# ADR-0003: Sanitized Convex `_storage` Image Pipeline

**Status:** Accepted

## Context

`Listing` photos appear on the unauthenticated public landing page. Raw smartphone uploads frequently embed GPS coordinates and camera EXIF metadata, and untrusted uploads can carry SVG XSS payloads or decompression bombs. Additionally, Next.js `<Image>` optimization with `remotePatterns` requires baking environment-specific storage hostnames at build time, which breaks build-once container promotion.

## Decision

1. **Narrow storage seam (`convex/listings/images.ts`):** Store images in Convex File Storage (`_storage`) behind a dedicated adapter so DTOs return only resolved URLs (never raw `storageId` on public surfaces), preserving 1:1 4-environment isolation and local parity while leaving a clean seam to swap to AWS S3 + CloudFront OAC at scale.
2. **Two-tier sanitization & anti-IDOR pipeline:**
   - Client pre-processing (`OffscreenCanvas` WebP resize) reduces upload size before hitting the server.
   - Clerk-authenticated Next.js BFF route (`POST /api/uploads/listing-image`) enforces a 5 MB cap, raster-only allowlist (JPEG, PNG, WebP — rejecting SVG/HTML), memory-safe `sharp` decoding (`cache: false`, `concurrency: 1`, `limitInputPixels: 40_000_000`), and full WebP re-encoding (max 1600×1600, quality 82) to strip all EXIF/GPS/XMP metadata before uploading to `_storage`.
   - `listingImageUploads` tracks ownership (`uploaderId`), enforces 10 uploads/min rate limiting and a 10-pending-upload cap per `User`, verifies ownership on `Listing` create/edit (anti-IDOR), deletes replaced/removed blobs atomically on edit/archive, and prunes abandoned `pending` uploads older than 2 hours via an hourly Convex cron.
3. **Build-once rendering:** Configure `images: { unoptimized: true, dangerouslyAllowSVG: false }` in `next.config.ts` and serve direct Convex storage URLs with lazy loading and explicit aspect ratios.

## Consequences

- Home GPS locations and malicious SVG payloads cannot reach storage or the public landing page.
- No build-time hostname baking or runtime Next.js image-proxy CPU overhead is needed in the container.
- Swapping to S3 + CloudFront OAC later is localized to the storage adapter seam.
