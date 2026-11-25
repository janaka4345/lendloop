import { AppNavbar } from "@/components/layout/app-navbar";
import { ListingDetailWorkbench } from "@/features/lending/components/listing-detail-workbench";

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen">
      <AppNavbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ListingDetailWorkbench listingId={id} />
      </main>
    </div>
  );
}
