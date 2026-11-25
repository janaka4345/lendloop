import { AppNavbar } from "@/components/layout/app-navbar";
import { LoansBoardView } from "@/features/lending/components/loans-board-view";

export default function MyRequestsPage() {
  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My Requests</h1>
          <p className="text-muted-foreground text-sm">
            Track your active and past Loan requests as a Borrower.
          </p>
        </header>
        <LoansBoardView mode="borrower" />
      </main>
    </div>
  );
}
