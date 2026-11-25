"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Menu, Plus, ShieldCheck, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { useHasConvexProvider } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE_NAV_LINKS = [
  { href: "/listings", label: "All Tools" },
  { href: "/my-listings", label: "My Listings" },
  { href: "/my-requests", label: "My Requests" },
  { href: "/incoming-requests", label: "Incoming Requests" },
] as const;

function IncomingPendingBadge() {
  const currentUser = useQuery(api.users.queries.getCurrentUser, {});
  const result = useQuery(api.lending.queries.getIncomingPendingCount, currentUser ? {} : "skip");
  const count = result?.count ?? 0;
  if (count <= 0) {
    return null;
  }

  return (
    <span
      aria-label={`${count} pending incoming requests`}
      className="bg-primary text-primary-foreground ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function AdminNavLink({
  pathname,
  onNavigate,
  mobile = false,
}: {
  pathname: string;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const currentUser = useQuery(api.users.queries.getCurrentUser, {});
  if (currentUser?.role !== "admin") {
    return null;
  }

  const isActive = pathname === "/admin" || pathname.startsWith("/admin/");
  return (
    <Link
      href="/admin"
      onClick={onNavigate}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors",
        mobile ? "w-full px-3 py-2" : "px-3 py-1.5",
        isActive
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      Admin
    </Link>
  );
}

export function AppNavbar() {
  const pathname = usePathname();
  const hasConvex = useHasConvexProvider();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-border bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/listings"
            className="text-foreground inline-flex items-center gap-2 text-base font-bold tracking-tight"
          >
            <span className="bg-primary text-primary-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg">
              <Wrench className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>LendLoop</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {BASE_NAV_LINKS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {item.label}
                  {hasConvex && item.href === "/incoming-requests" ? (
                    <IncomingPendingBadge />
                  ) : null}
                </Link>
              );
            })}
            {hasConvex ? <AdminNavLink pathname={pathname} /> : null}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/listings/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              List a Tool
            </Link>
          </Button>
          {hasConvex ? <UserButton /> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-border bg-background border-t px-4 py-3 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {BASE_NAV_LINKS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "inline-flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <span>{item.label}</span>
                  {hasConvex && item.href === "/incoming-requests" ? (
                    <IncomingPendingBadge />
                  ) : null}
                </Link>
              );
            })}
            {hasConvex ? (
              <AdminNavLink pathname={pathname} onNavigate={() => setMobileOpen(false)} mobile />
            ) : null}
            <div className="pt-2">
              <Button asChild size="sm" className="w-full" onClick={() => setMobileOpen(false)}>
                <Link href="/listings/new">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  List a Tool
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
