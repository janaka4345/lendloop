"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useRef } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DOMAIN_LIMITS } from "@/domain/types";

export interface ListingPhotoItem {
  id: string;
  storageId?: Id<"_storage">;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  isNewlyUploaded: boolean;
  error?: string;
}

export interface ListingPhotoUploaderProps {
  photos: ListingPhotoItem[];
  onSelectFiles: (files: FileList) => void;
  onRemoveOrCancel: (photo: ListingPhotoItem) => void;
  onMoveLeft: (index: number) => void;
  onMoveRight: (index: number) => void;
  onSetAsCover: (index: number) => void;
  disabled?: boolean;
}

export function ListingPhotoUploader({
  photos,
  onSelectFiles,
  onRemoveOrCancel,
  onMoveLeft,
  onMoveRight,
  onSetAsCover,
  disabled = false,
}: ListingPhotoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const remainingSlots = Math.max(0, DOMAIN_LIMITS.MAX_LISTING_IMAGES - photos.length);

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <AlertTitle>Photo privacy notice</AlertTitle>
            <AlertDescription>
              Listing photos appear on the public LendLoop landing page. Use a plain background and
              avoid showing house numbers, street signs, or license plates. EXIF and GPS metadata
              are stripped automatically when you upload.
            </AlertDescription>
          </div>
        </div>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            Photos ({photos.length} / {DOMAIN_LIMITS.MAX_LISTING_IMAGES})
          </p>
          <p className="text-muted-foreground text-xs">
            Optional. JPEG, PNG, or WebP up to 5 MB each. First photo is the cover image.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          aria-label="Upload Listing photos"
          disabled={disabled || remainingSlots === 0}
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              onSelectFiles(event.target.files);
              event.target.value = "";
            }
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || remainingSlots === 0}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {remainingSlots === 0 ? "Maximum 5 photos reached" : "Add photos"}
        </Button>
      </div>

      {photos.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, index) => (
            <div
              key={photo.id}
              className="border-border bg-card overflow-hidden rounded-lg border shadow-xs"
            >
              <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.previewUrl}
                  alt={`Listing photo ${index + 1}`}
                  className="h-full w-full object-cover"
                />

                {index === 0 && photo.status === "ready" ? (
                  <Badge className="absolute top-2 left-2 bg-slate-950/80 text-white">Cover</Badge>
                ) : null}

                {photo.status === "uploading" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/60 p-3 text-white">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    <span className="text-xs font-medium">Sanitizing & uploading...</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onRemoveOrCancel(photo)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Cancel
                    </Button>
                  </div>
                ) : null}

                {photo.status === "error" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-950/80 p-3 text-center text-white">
                    <AlertCircle className="h-5 w-5" aria-hidden="true" />
                    <span className="text-xs font-medium">{photo.error ?? "Upload failed"}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onRemoveOrCancel(photo)}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>

              {photo.status === "ready" ? (
                <div className="flex flex-wrap items-center justify-between gap-1 p-2">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={disabled || index === 0}
                      aria-label={`Move photo ${index + 1} left`}
                      title="Move Left"
                      onClick={() => onMoveLeft(index)}
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={disabled || index === photos.length - 1}
                      aria-label={`Move photo ${index + 1} right`}
                      title="Move Right"
                      onClick={() => onMoveRight(index)}
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {index > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={disabled}
                        onClick={() => onSetAsCover(index)}
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                        Set as Cover
                      </Button>
                    ) : null}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive h-8 w-8"
                    disabled={disabled}
                    aria-label={`Remove photo ${index + 1}`}
                    title="Remove"
                    onClick={() => onRemoveOrCancel(photo)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
