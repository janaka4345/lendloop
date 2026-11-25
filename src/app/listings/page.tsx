import { AppNavbar } from "@/components/layout/app-navbar";
import { AllToolsCatalog } from "@/features/listings/components/all-tools-catalog";

export default function ListingsCatalogPage() {
  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">All Tools</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Browse active neighborhood Listings, filter by Category or Availability, and request to
            borrow tools.
          </p>
        </header>
        <AllToolsCatalog />
      </main>
    </div>
  );
}
