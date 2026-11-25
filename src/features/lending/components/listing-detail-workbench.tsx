"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  AlertTriangle,
  Award,
  CalendarDays,
  ChevronRight,
  Inbox,
  Pencil,
  SearchX,
  ShieldAlert,
  User as UserIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useMemo, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AppErrorData } from "../../../../convex/lib/errors";
import { useHasConvexProvider, useSyncedCurrentUser } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayUtcDate } from "@/domain/dates";
import { DOMAIN_LIMITS } from "@/domain/types";
import {
  borrowRequestSchema,
  extractAppErrorMessage,
  type BorrowRequestInput,
  type BorrowRequestValues,
} from "@/features/lending/schema";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/features/listings/schema";
import { ListingHeroGallery } from "./listing-hero-gallery";
import { UtcRangeCalendar } from "./utc-range-calendar";

class ListingDetailErrorBoundary extends Component<
  { listingId: string; children: ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(prevProps: { listingId: string; children: ReactNode }) {
    if (this.state.error && prevProps.listingId !== this.props.listingId) {
      this.setState({ error: null });
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    let code: AppErrorData["code"] | null = null;
    let message: string | null = null;
    if (this.state.error instanceof ConvexError) {
      const data = this.state.error.data as Partial<AppErrorData> | undefined;
      if (data?.code) code = data.code;
      if (data?.message) message = data.message;
    }

    const isNotFound = code === "NOT_FOUND";
    const isForbidden = code === "FORBIDDEN";
    const isUnauthenticated = code === "UNAUTHENTICATED";
    const isRetryable = !isNotFound && !isForbidden;

    const Icon = isNotFound ? SearchX : isForbidden ? ShieldAlert : AlertTriangle;
    const title = isNotFound
      ? "Listing not found"
      : isForbidden
        ? "Permission denied"
        : isUnauthenticated
          ? "Authentication required"
          : "Unable to load Listing";
    const description = isNotFound
      ? "This Listing may have been removed or the link may be invalid."
      : isForbidden
        ? (message ?? "You do not have permission to view this Listing.")
        : isUnauthenticated
          ? (message ?? "Your session is not ready yet. Please try again.")
          : (message ?? "Something went wrong while loading this Listing. Please try again.");

    return (
      <div className="border-border bg-card mx-auto max-w-lg rounded-xl border p-8 text-center">
        <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Icon className="text-muted-foreground h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {isRetryable ? (
            <Button type="button" onClick={this.handleRetry}>
              Try again
            </Button>
          ) : null}
          <Button asChild variant={isRetryable ? "outline" : "default"}>
            <Link href="/listings">Back to All Tools</Link>
          </Button>
        </div>
      </div>
    );
  }
}

function BorrowRequestCard({
  listingId,
  listingName,
  bookedRanges,
}: {
  listingId: Id<"listings">;
  listingName: string;
  bookedRanges: ReadonlyArray<{ startDate: string; endDate: string }>;
}) {
  const router = useRouter();
  const requestLoan = useMutation(api.lending.mutations.requestLoan);
  const [serverError, setServerError] = useState<string | null>(null);
  const todayUtc = useMemo(() => todayUtcDate(), []);
  const schema = useMemo(
    () => borrowRequestSchema(todayUtc, bookedRanges),
    [todayUtc, bookedRanges],
  );

  const {
    register,
    setValue,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<BorrowRequestInput, unknown, BorrowRequestValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      startDate: "",
      endDate: "",
      note: "",
    },
  });

  const startDate = useWatch({ control, name: "startDate" }) ?? "";
  const endDate = useWatch({ control, name: "endDate" }) ?? "";
  const note = useWatch({ control, name: "note" }) ?? "";

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await requestLoan({
        listingId,
        startDate: values.startDate,
        endDate: values.endDate,
        ...(values.note ? { note: values.note } : {}),
      });
      toast.success(`Loan request sent for ${listingName}.`);
      router.push("/my-requests");
    } catch (error) {
      // Preserve form inputs on overlap race condition or validation error
      setServerError(extractAppErrorMessage(error, "Could not submit Loan request."));
    }
  });

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Request to Borrow</CardTitle>
        <CardDescription>
          Pick your dates in UTC. Your request stays pending until the Lender approves.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {serverError ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to submit request</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label>Borrow Dates (UTC)</Label>
            <UtcRangeCalendar
              todayUtc={todayUtc}
              bookedRanges={bookedRanges}
              startDate={startDate}
              endDate={endDate}
              disabled={isSubmitting}
              onChange={(next) => {
                setServerError(null);
                setValue("startDate", next.startDate, { shouldValidate: true });
                setValue("endDate", next.endDate, { shouldValidate: true });
              }}
            />
            {errors.startDate ? (
              <p className="text-destructive text-xs">{errors.startDate.message}</p>
            ) : null}
            {errors.endDate ? (
              <p className="text-destructive text-xs">{errors.endDate.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="borrow-note">Note to Lender (optional)</Label>
              <span className="text-muted-foreground text-xs">
                {note.length}/{DOMAIN_LIMITS.MAX_LOAN_NOTE_LENGTH}
              </span>
            </div>
            <Textarea
              id="borrow-note"
              rows={3}
              maxLength={DOMAIN_LIMITS.MAX_LOAN_NOTE_LENGTH}
              placeholder="Share what project you're working on or preferred pickup time..."
              disabled={isSubmitting}
              {...register("note")}
            />
            {errors.note ? <p className="text-destructive text-xs">{errors.note.message}</p> : null}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Submitting Request..." : "Request Loan"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LiveListingDetailContent({ listingId }: { listingId: Id<"listings"> }) {
  const currentUser = useSyncedCurrentUser();
  const listing = useQuery(
    api.listings.queries.getListingDetail,
    currentUser ? { listingId } : "skip",
  );

  if (listing === undefined) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true">
        <div className="space-y-4">
          <div className="bg-muted h-5 w-48 animate-pulse rounded" />
          <div className="bg-muted aspect-[4/3] w-full animate-pulse rounded-xl" />
          <div className="bg-muted h-8 w-2/3 animate-pulse rounded" />
          <div className="bg-muted h-24 w-full animate-pulse rounded" />
        </div>
        <div className="bg-muted h-96 w-full animate-pulse rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav
        aria-label="Breadcrumb"
        className="text-muted-foreground flex items-center gap-1.5 text-sm"
      >
        <Link href="/listings" className="hover:text-foreground transition-colors">
          All Tools
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-foreground truncate font-medium">{listing.name}</span>
      </nav>

      {listing.isArchived ? (
        <Alert variant="destructive">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <AlertTitle>Listing removed</AlertTitle>
              <AlertDescription>
                This Listing has been removed and is no longer available for new Loan requests.
                Existing active Loans remain visible and returnable from My Requests and Incoming
                Requests.
              </AlertDescription>
            </div>
          </div>
        </Alert>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left Column: Gallery, Metadata, Description, Lender Card, Upcoming Booked Dates */}
        <div className="min-w-0 space-y-6">
          <ListingHeroGallery
            images={listing.images}
            name={listing.name}
            category={listing.category}
          />

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {listing.isArchived ? (
                <Badge variant="destructive">Listing removed</Badge>
              ) : (
                <Badge
                  variant={listing.availability === "Available" ? "default" : "secondary"}
                  className={
                    listing.availability === "Available"
                      ? "bg-emerald-600 text-white hover:bg-emerald-600"
                      : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  }
                >
                  {listing.availability}
                </Badge>
              )}
              <Badge variant="secondary">{CATEGORY_LABELS[listing.category]}</Badge>
              <Badge variant="outline">{CONDITION_LABELS[listing.condition]}</Badge>
            </div>

            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{listing.name}</h1>

            <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap sm:text-base">
              {listing.description}
            </p>
          </div>

          {/* Lender Card */}
          <Card>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="bg-secondary text-secondary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <UserIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Lender
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{listing.lender.displayName}</span>
                    {listing.lender.trustedLender ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-sky-500/15 text-sky-800 dark:text-sky-300"
                      >
                        <Award className="h-3.5 w-3.5" aria-hidden="true" />
                        Trusted Lender
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming Approved Booked Date Ranges (Zero Borrower Identity) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="text-muted-foreground h-4 w-4" aria-hidden="true" />
                Upcoming Booked Dates (UTC)
              </CardTitle>
              <CardDescription>
                Approved Loan dates are unavailable for new requests.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {listing.bookedRanges.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No upcoming approved bookings. All future dates are currently open.
                </p>
              ) : (
                <ul className="space-y-2">
                  {listing.bookedRanges.map((range, index) => (
                    <li
                      key={`${range.startDate}-${range.endDate}-${index}`}
                      className="bg-muted/50 border-border flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <span className="font-medium">
                        {range.startDate}
                        {range.endDate !== range.startDate ? ` → ${range.endDate}` : ""}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Booked
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky Right Column: Borrow Request / Your Listing / Listing Removed */}
        <div className="lg:sticky lg:top-24">
          {listing.isArchived ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Borrowing Unavailable</CardTitle>
                <CardDescription>
                  This Listing has been removed and can no longer accept new Loan requests.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild variant="outline" className="w-full">
                  <Link href="/my-requests">View My Requests</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/incoming-requests">View Incoming Requests</Link>
                </Button>
              </CardContent>
            </Card>
          ) : listing.isOwnListing ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Your Listing</CardTitle>
                <CardDescription>
                  You are the Lender for this Listing. Manage details or review incoming Loan
                  requests below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild className="w-full">
                  <Link href={`/listings/${listing._id}/edit`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit Listing
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/incoming-requests">
                    <Inbox className="h-4 w-4" aria-hidden="true" />
                    Incoming Requests
                    {(listing.pendingRequestCount ?? 0) > 0 ? (
                      <Badge className="ml-1.5">{listing.pendingRequestCount} pending</Badge>
                    ) : null}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <BorrowRequestCard
              listingId={listing._id}
              listingName={listing.name}
              bookedRanges={listing.bookedRanges}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ListingDetailWorkbench({ listingId }: { listingId: string }) {
  const hasConvex = useHasConvexProvider();
  if (!hasConvex) {
    return (
      <div className="border-border bg-card rounded-xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Connect Clerk and Convex to view Listing details and request Loans.
        </p>
      </div>
    );
  }

  return (
    <ListingDetailErrorBoundary key={listingId} listingId={listingId}>
      <LiveListingDetailContent listingId={listingId as Id<"listings">} />
    </ListingDetailErrorBoundary>
  );
}
