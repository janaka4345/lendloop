"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useHasConvexProvider, useSyncedCurrentUser } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { ADMIN_TABS, type AdminTabId } from "@/features/admin/schema";
import { cn } from "@/lib/utils";
import { AdminAuditLogTab } from "./admin-audit-log-tab";
import { AdminListingsTab } from "./admin-listings-tab";
import { AdminLoansTab } from "./admin-loans-tab";
import { AdminUsersTab } from "./admin-users-tab";

function UnauthorizedAdminState() {
  return (
    <div className="border-border bg-card mx-auto flex max-w-lg flex-col items-center gap-4 rounded-xl border p-8 text-center">
      <div className="bg-destructive/10 text-destructive flex h-12 w-12 items-center justify-center rounded-full">
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Admin access required</h2>
        <p className="text-muted-foreground text-sm">
          You do not have permission to view the Admin governance console. All administrative
          queries and actions are strictly enforced on the server.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/listings">Back to All Tools</Link>
      </Button>
    </div>
  );
}

function AdminPanelContent() {
  const currentUser = useSyncedCurrentUser();
  const [activeTab, setActiveTab] = useState<AdminTabId>("users");

  if (currentUser === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="bg-muted h-10 w-80 animate-pulse rounded-lg" />
        <div className="bg-muted h-48 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (!currentUser || currentUser.role !== "admin") {
    return <UnauthorizedAdminState />;
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Admin sections"
        className="border-border flex items-center gap-1 overflow-x-auto border-b pb-px"
      >
        {ADMIN_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`admin-tabpanel-${tab.id}`}
              id={`admin-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id={`admin-tabpanel-${activeTab}`}
        aria-labelledby={`admin-tab-${activeTab}`}
      >
        {activeTab === "users" ? <AdminUsersTab /> : null}
        {activeTab === "listings" ? <AdminListingsTab /> : null}
        {activeTab === "loans" ? <AdminLoansTab /> : null}
        {activeTab === "audit" ? <AdminAuditLogTab /> : null}
      </section>
    </div>
  );
}

export function AdminPanelView() {
  const hasConvex = useHasConvexProvider();

  if (!hasConvex) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-3 rounded-xl border p-8 text-center">
        <ShieldCheck className="text-muted-foreground h-8 w-8" aria-hidden="true" />
        <p className="text-muted-foreground text-sm">
          Connect a Convex deployment to use the Admin governance console.
        </p>
      </div>
    );
  }

  return <AdminPanelContent />;
}
