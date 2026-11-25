"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Award, Package, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DOMAIN_LIMITS,
  type ListingAvailability,
  type ListingCategory,
  type ListingCondition,
} from "@/domain/types";
import {
  adminRemoveListingSchema,
  type AdminRemoveListingFormValues,
} from "@/features/admin/schema";
import { extractAppErrorMessage } from "@/features/lending/schema";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/features/listings/schema";
import { AdminPaginationControls, useCursorPagination } from "./admin-pagination";

type ListingStatusFilter = "all" | "active" | "archived";

interface AdminListingItem {
  _id: Id<"listings">;
  name: string;
  category: ListingCategory;
  condition: ListingCondition;
  availability: ListingAvailability;
  isArchived: boolean;
  archivedAt?: number;
  archiveReason?: string;
  imageCount: number;
  activeApprovedLoanCount: number;
  pendingRequestCount: number;
  lender: {
    id: Id<"users">;
    displayName: string;
    trustedLender: boolean;
  };
  createdAt: number;
}

const STATUS_FILTERS: ReadonlyArray<{ value: ListingStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const PAGE_SIZE = 25;

export function AdminListingsTab() {
  const [statusFilter, setStatusFilter] = useState<ListingStatusFilter>("all");
  const pagination = useCursorPagination();

  const page = useQuery(api.listings.queries.listAllListingsForAdmin, {
    status: statusFilter,
    cursor: pagination.currentCursor,
    limit: PAGE_SIZE,
  });

  const adminRemoveListing = useMutation(api.listings.mutations.adminRemoveListing);
  const [targetListing, setTargetListing] = useState<AdminListingItem | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AdminRemoveListingFormValues>({
    resolver: zodResolver(adminRemoveListingSchema),
    mode: "onBlur",
    defaultValues: { archiveReason: "" },
  });

  const reasonValue = useWatch({
    control: form.control,
    name: "archiveReason",
    defaultValue: "",
  });

  const submitting = form.formState.isSubmitting;

  const handleStatusChange = (nextStatus: ListingStatusFilter) => {
    setStatusFilter(nextStatus);
    pagination.reset();
  };

  const openRemoveDialog = (listing: AdminListingItem) => {
    form.reset({ archiveReason: "" });
    setServerError(null);
    setTargetListing(listing);
  };

  const closeDialog = () => {
    if (submitting) return;
    setTargetListing(null);
    setServerError(null);
    form.reset({ archiveReason: "" });
  };

  const handleConfirmRemove = form.handleSubmit(async (values) => {
    if (!targetListing) return;
    setServerError(null);
    try {
      const result = await adminRemoveListing({
        listingId: targetListing._id,
        archiveReason: values.archiveReason,
      });
      toast.success(
        result.autoDeclinedCount > 0
          ? `Listing removed. ${result.autoDeclinedCount} pending request(s) auto-declined and ${result.deletedImageCount} photo(s) deleted.`
          : `Listing removed (${result.deletedImageCount} photo(s) deleted).`,
      );
      setTargetListing(null);
      form.reset({ archiveReason: "" });
    } catch (error) {
      setServerError(extractAppErrorMessage(error, "Could not remove Listing."));
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            type="button"
            size="sm"
            variant={statusFilter === filter.value ? "default" : "outline"}
            onClick={() => handleStatusChange(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {page === undefined ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="bg-muted h-24 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : page.items.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-xl border p-10 text-center">
          <Package className="text-muted-foreground h-8 w-8" aria-hidden="true" />
          <p className="text-sm font-medium">No Listings match this filter.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {page.items.map((listing) => (
              <article
                key={listing._id}
                className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {listing.isArchived ? (
                      <Badge variant="destructive">Archived</Badge>
                    ) : (
                      <Badge
                        variant={listing.availability === "Available" ? "default" : "secondary"}
                        className={
                          listing.availability === "Available"
                            ? "bg-emerald-600 text-white hover:bg-emerald-600"
                            : undefined
                        }
                      >
                        {listing.availability}
                      </Badge>
                    )}
                    <Badge variant="outline">{CATEGORY_LABELS[listing.category]}</Badge>
                    <Badge variant="outline">{CONDITION_LABELS[listing.condition]}</Badge>
                  </div>

                  <h3 className="text-base font-semibold tracking-tight">
                    <Link
                      href={`/listings/${listing._id}`}
                      className="hover:text-primary transition-colors hover:underline"
                    >
                      {listing.name}
                    </Link>
                  </h3>

                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span>
                        Lender:{" "}
                        <strong className="text-foreground font-medium">
                          {listing.lender.displayName}
                        </strong>
                      </span>
                      {listing.lender.trustedLender ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 bg-sky-500/15 text-[11px] text-sky-800 dark:text-sky-300"
                        >
                          <Award className="h-3 w-3" aria-hidden="true" />
                          Trusted Lender
                        </Badge>
                      ) : null}
                    </span>
                    <span>Photos: {listing.imageCount}</span>
                    <span>Approved Loans: {listing.activeApprovedLoanCount}</span>
                    <span>Pending Requests: {listing.pendingRequestCount}</span>
                  </div>

                  {listing.isArchived && listing.archiveReason ? (
                    <p className="rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-800 dark:text-rose-200">
                      <span className="font-medium">Removal reason: </span>
                      {listing.archiveReason}
                    </p>
                  ) : null}
                </div>

                {!listing.isArchived ? (
                  <div className="sm:shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => openRemoveDialog(listing)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Remove Listing
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <AdminPaginationControls
            pageIndex={pagination.pageIndex}
            isDone={page.isDone}
            onPrev={pagination.goPrev}
            onNext={() => pagination.goNext(page.continueCursor, page.isDone)}
          />
        </>
      )}

      <ModalDialog
        open={targetListing !== null}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title="Remove Listing as Admin?"
        description={
          targetListing ? (
            <>
              Force-archive <strong className="text-foreground">{targetListing.name}</strong> by{" "}
              <strong className="text-foreground">{targetListing.lender.displayName}</strong>. All
              photos will be deleted immediately and an Audit Log entry will be written.
            </>
          ) : null
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="admin-remove-listing-form"
              variant="destructive"
              disabled={submitting}
            >
              {submitting ? "Removing..." : "Confirm Removal"}
            </Button>
          </>
        }
      >
        <form id="admin-remove-listing-form" onSubmit={handleConfirmRemove} className="space-y-3">
          {targetListing &&
          (targetListing.activeApprovedLoanCount > 0 || targetListing.pendingRequestCount > 0) ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="space-y-1">
                {targetListing.activeApprovedLoanCount > 0 ? (
                  <p>
                    This Listing has{" "}
                    <strong>
                      {targetListing.activeApprovedLoanCount} active approved{" "}
                      {targetListing.activeApprovedLoanCount === 1 ? "Loan" : "Loans"}
                    </strong>
                    . Active Loans will remain returnable and flagged as &ldquo;Listing
                    removed&rdquo;.
                  </p>
                ) : null}
                {targetListing.pendingRequestCount > 0 ? (
                  <p>
                    <strong>
                      {targetListing.pendingRequestCount} open pending{" "}
                      {targetListing.pendingRequestCount === 1 ? "request" : "requests"}
                    </strong>{" "}
                    will be atomically auto-declined.
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {serverError ? (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="admin-archive-reason">Archive reason (required)</Label>
              <span className="text-muted-foreground text-xs">
                {reasonValue.length}/{DOMAIN_LIMITS.MAX_REASON_LENGTH}
              </span>
            </div>
            <Textarea
              id="admin-archive-reason"
              rows={3}
              maxLength={DOMAIN_LIMITS.MAX_REASON_LENGTH}
              placeholder="Explain why this Listing is being removed..."
              aria-invalid={Boolean(form.formState.errors.archiveReason)}
              disabled={submitting}
              {...form.register("archiveReason")}
            />
            {form.formState.errors.archiveReason ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.archiveReason.message}
              </p>
            ) : null}
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
