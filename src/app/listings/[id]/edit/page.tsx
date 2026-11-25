import { AppNavbar } from "@/components/layout/app-navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EditListingView } from "@/features/listings/components/edit-listing-view";

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Edit Listing</CardTitle>
            <CardDescription>
              Update your Listing details or manage photos. Removed photos are deleted permanently
              when you save.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditListingView listingId={id} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
