import { AppNavbar } from "@/components/layout/app-navbar";
import { AdminPanelView } from "@/features/admin/components/admin-panel-view";

export default function AdminPage() {
  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Console</h1>
          <p className="text-muted-foreground text-sm">
            Manage Trusted Lender badges, moderate Listings, monitor platform Loans and notification
            delivery, and inspect the append-only Audit Log.
          </p>
        </header>
        <AdminPanelView />
      </main>
    </div>
  );
}
