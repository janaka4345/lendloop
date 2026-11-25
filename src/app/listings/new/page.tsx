import { AppNavbar } from "@/components/layout/app-navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListingForm } from "@/features/listings/components/listing-form";

export default function NewListingPage() {
  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">List a Tool</CardTitle>
            <CardDescription>
              Add details and optional photos so neighbors can discover and request your tool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ListingForm mode="create" />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
