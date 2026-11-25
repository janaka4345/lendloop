"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AppErrorData } from "../../../../convex/lib/errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DOMAIN_LIMITS,
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  type ListingCategory,
  type ListingCondition,
} from "@/domain/types";
import { preprocessImageForUpload, validateClientImageFile } from "../client-image-resize";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  listingFormSchema,
  type ListingFormInput,
  type ListingFormValues,
} from "../schema";
import { ListingPhotoUploader, type ListingPhotoItem } from "./listing-photo-uploader";

export interface ListingFormInitialValues {
  listingId: Id<"listings">;
  name: string;
  category: ListingCategory;
  condition: ListingCondition;
  description: string;
  images: Array<{ storageId: Id<"_storage">; url: string }>;
}

export interface ListingFormProps {
  mode: "create" | "edit";
  initialValues?: ListingFormInitialValues;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as Partial<AppErrorData> | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function ListingForm({ mode, initialValues }: ListingFormProps) {
  const router = useRouter();
  const createListing = useMutation(api.listings.mutations.createListing);
  const updateListing = useMutation(api.listings.mutations.updateListing);
  const discardPendingUpload = useMutation(api.listings.mutations.discardPendingListingImageUpload);

  const [photos, setPhotos] = useState<ListingPhotoItem[]>(() =>
    (initialValues?.images ?? []).map((img, idx) => ({
      id: `existing-${img.storageId}-${idx}`,
      storageId: img.storageId,
      previewUrl: img.url,
      status: "ready" as const,
      isNewlyUploaded: false,
    })),
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const savedRef = useRef(false);
  const photosRef = useRef(photos);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ListingFormInput, unknown, ListingFormValues>({
    resolver: zodResolver(listingFormSchema),
    mode: "onBlur",
    defaultValues: {
      name: initialValues?.name ?? "",
      category: initialValues?.category ?? "power_tools",
      condition: initialValues?.condition ?? "good",
      description: initialValues?.description ?? "",
      imageIds: (initialValues?.images ?? []).map((img) => img.storageId),
    },
  });

  const nameValue = useWatch({ control, name: "name" }) ?? "";
  const descriptionValue = useWatch({ control, name: "description" }) ?? "";

  useEffect(() => {
    const readyIds = photos
      .filter((p) => p.status === "ready" && p.storageId)
      .map((p) => p.storageId as string);
    setValue("imageIds", readyIds, { shouldValidate: true });
  }, [photos, setValue]);

  // Cleanup any in-flight uploads and object URLs on unmount; discard unsaved pending uploads
  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();

      for (const photo of photosRef.current) {
        if (photo.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(photo.previewUrl);
        }
        if (!savedRef.current && photo.isNewlyUploaded && photo.storageId) {
          void discardPendingUpload({ storageId: photo.storageId }).catch(() => {});
        }
      }
    };
  }, [discardPendingUpload]);

  const handleSelectFiles = useCallback(
    async (fileList: FileList) => {
      const remaining = Math.max(0, DOMAIN_LIMITS.MAX_LISTING_IMAGES - photosRef.current.length);
      const selected = Array.from(fileList).slice(0, remaining);
      if (selected.length === 0) return;

      for (const file of selected) {
        const localId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const validationError = validateClientImageFile(file);
        const previewUrl = URL.createObjectURL(file);

        if (validationError) {
          setPhotos((prev) => [
            ...prev,
            {
              id: localId,
              previewUrl,
              status: "error",
              isNewlyUploaded: true,
              error: validationError,
            },
          ]);
          continue;
        }

        const controller = new AbortController();
        abortControllersRef.current.set(localId, controller);

        setPhotos((prev) => [
          ...prev,
          {
            id: localId,
            previewUrl,
            status: "uploading",
            isNewlyUploaded: true,
          },
        ]);

        void (async () => {
          try {
            const processed = await preprocessImageForUpload(file);
            if (controller.signal.aborted) return;

            const formData = new FormData();
            formData.append("file", processed);

            const response = await fetch("/api/uploads/listing-image", {
              method: "POST",
              body: formData,
              signal: controller.signal,
            });

            const payload = (await response.json().catch(() => ({}))) as {
              storageId?: Id<"_storage">;
              url?: string;
              error?: string;
            };

            if (!response.ok || !payload.storageId || !payload.url) {
              throw new Error(payload.error ?? "Photo upload failed.");
            }

            if (controller.signal.aborted) {
              void discardPendingUpload({ storageId: payload.storageId }).catch(() => {});
              return;
            }

            setPhotos((prev) =>
              prev.map((item) =>
                item.id === localId
                  ? {
                      ...item,
                      storageId: payload.storageId,
                      previewUrl: payload.url!,
                      status: "ready",
                      error: undefined,
                    }
                  : item,
              ),
            );
            URL.revokeObjectURL(previewUrl);
          } catch (error) {
            if (controller.signal.aborted) return;
            const message =
              error instanceof Error && error.message ? error.message : "Photo upload failed.";
            setPhotos((prev) =>
              prev.map((item) =>
                item.id === localId ? { ...item, status: "error", error: message } : item,
              ),
            );
          } finally {
            abortControllersRef.current.delete(localId);
          }
        })();
      }
    },
    [discardPendingUpload],
  );

  const handleRemoveOrCancel = useCallback(
    (photo: ListingPhotoItem) => {
      const controller = abortControllersRef.current.get(photo.id);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(photo.id);
      }

      if (photo.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(photo.previewUrl);
      }

      setPhotos((prev) => prev.filter((item) => item.id !== photo.id));

      if (photo.isNewlyUploaded && photo.storageId) {
        void discardPendingUpload({ storageId: photo.storageId }).catch(() => {});
      }
    },
    [discardPendingUpload],
  );

  const handleMoveLeft = useCallback((index: number) => {
    if (index <= 0) return;
    setPhotos((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1]!;
      copy[index - 1] = copy[index]!;
      copy[index] = temp;
      return copy;
    });
  }, []);

  const handleMoveRight = useCallback((index: number) => {
    setPhotos((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      const copy = [...prev];
      const temp = copy[index + 1]!;
      copy[index + 1] = copy[index]!;
      copy[index] = temp;
      return copy;
    });
  }, []);

  const handleSetAsCover = useCallback((index: number) => {
    if (index <= 0) return;
    setPhotos((prev) => {
      const copy = [...prev];
      const [chosen] = copy.splice(index, 1);
      if (!chosen) return prev;
      return [chosen, ...copy];
    });
  }, []);

  const hasInFlightUploads = photos.some((p) => p.status === "uploading");
  const hasFailedUploads = photos.some((p) => p.status === "error");

  const onSubmit = async (values: ListingFormValues) => {
    if (hasInFlightUploads) return;
    if (hasFailedUploads) {
      setServerError("Please remove failed photo uploads before saving.");
      return;
    }

    setServerError(null);
    const orderedStorageIds = values.imageIds as Id<"_storage">[];

    try {
      if (mode === "create") {
        await createListing({
          name: values.name,
          category: values.category,
          condition: values.condition,
          description: values.description,
          imageIds: orderedStorageIds,
        });
        savedRef.current = true;
        toast.success("Listing created");
        router.push("/my-listings");
      } else if (initialValues) {
        await updateListing({
          listingId: initialValues.listingId,
          name: values.name,
          category: values.category,
          condition: values.condition,
          description: values.description,
          imageIds: orderedStorageIds,
        });
        savedRef.current = true;
        toast.success("Listing updated");
        router.push("/my-listings");
      }
    } catch (error) {
      const message = extractErrorMessage(error, "Unable to save Listing. Please try again.");
      setServerError(message);
      toast.error(message);
    }
  };

  const handleCancel = () => {
    router.push("/my-listings");
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    void handleSubmit(onSubmit)(event);
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to save Listing</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="listing-name">Listing name</Label>
          <span className="text-muted-foreground text-xs">
            {nameValue.length} / {DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH}
          </span>
        </div>
        <Input
          id="listing-name"
          placeholder="e.g., DeWalt 20V Cordless Hammer Drill"
          maxLength={DOMAIN_LIMITS.MAX_LISTING_NAME_LENGTH}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "listing-name-error" : undefined}
          {...register("name")}
        />
        {errors.name ? (
          <p id="listing-name-error" className="text-destructive text-xs">
            {errors.name.message}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="listing-category">Category</Label>
          <select
            id="listing-category"
            aria-invalid={Boolean(errors.category)}
            className="border-input bg-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            {...register("category")}
          >
            {LISTING_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          {errors.category ? (
            <p className="text-destructive text-xs">{errors.category.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="listing-condition">Condition</Label>
          <select
            id="listing-condition"
            aria-invalid={Boolean(errors.condition)}
            className="border-input bg-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            {...register("condition")}
          >
            {LISTING_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {CONDITION_LABELS[condition]}
              </option>
            ))}
          </select>
          {errors.condition ? (
            <p className="text-destructive text-xs">{errors.condition.message}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="listing-description">Description</Label>
          <span className="text-muted-foreground text-xs">
            {descriptionValue.length} / {DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH}
          </span>
        </div>
        <Textarea
          id="listing-description"
          placeholder="Describe included accessories, battery/power requirements, and care instructions."
          maxLength={DOMAIN_LIMITS.MAX_LISTING_DESCRIPTION_LENGTH}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "listing-description-error" : undefined}
          {...register("description")}
        />
        {errors.description ? (
          <p id="listing-description-error" className="text-destructive text-xs">
            {errors.description.message}
          </p>
        ) : null}
      </div>

      <ListingPhotoUploader
        photos={photos}
        onSelectFiles={handleSelectFiles}
        onRemoveOrCancel={handleRemoveOrCancel}
        onMoveLeft={handleMoveLeft}
        onMoveRight={handleMoveRight}
        onSetAsCover={handleSetAsCover}
        disabled={isSubmitting}
      />

      <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || hasInFlightUploads}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Saving...
            </>
          ) : hasInFlightUploads ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Waiting for uploads...
            </>
          ) : mode === "create" ? (
            "Publish Listing"
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </form>
  );
}
