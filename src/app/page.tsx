import { Wrench } from "lucide-react";
import { SignInCtaButton } from "@/components/auth/sign-in-cta-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicListingsSection } from "@/features/listings/components/public-listings-section";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6 sm:py-16">
      <header className="space-y-4">
        <Badge variant="secondary" className="w-fit gap-1.5">
          <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
          Neighborhood Tool Lending
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">LendLoop</h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          Share tools with neighbors, coordinate conflict-free borrow dates, and stay on top of
          returns without exposing personal contact details.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <SignInCtaButton />
        </div>
      </header>

      <PublicListingsSection />

      <section aria-label="Platform highlights" className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Privacy-First Discovery</CardTitle>
            <CardDescription>
              Browse available listings by name, category, and sanitized photos.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Zero lender personal details are exposed on public pages.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Conflict-Free Loans</CardTitle>
            <CardDescription>
              Non-overlapping calendar dates with clear approval and return states.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Approving a loan automatically declines overlapping pending requests.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Automated Reminders</CardTitle>
            <CardDescription>
              Reliable email updates and daily overdue reminders via n8n.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Every loan displays its live automation activity timeline.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
