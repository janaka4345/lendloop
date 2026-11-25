import { Plus } from "lucide-react";
import Link from "next/link";
import { AppNavbar } from "@/components/layout/app-navbar";
import { Button } from "@/components/ui/button";
import { MyListingsView } from "@/features/listings/components/my-listings-view";

export default function MyListingsPage() {
  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">My Listings</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage the tools you share, track derived Availability, and review pending requests.
            </p>
          </div>
          <Button asChild>
            <Link href="/listings/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              List a Tool
            </Link>
          </Button>
        </header>
        <MyListingsView />
      </main>
    </div>
  );
}
