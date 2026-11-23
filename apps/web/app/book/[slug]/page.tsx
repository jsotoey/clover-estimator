import type { Metadata } from "next";
import { bookingStore } from "@/lib/booking";
import BookingForm from "./BookingForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const store = await bookingStore((await params).slug).catch(() => null);
  return { title: store ? `Book a visit · ${store.name}` : "Book a visit", robots: { index: false } };
}

/** Public page customers reach from the store's website: book an on-site visit. */
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await bookingStore(slug).catch(() => null);
  if (!store)
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="font-display text-2xl font-bold">Online booking isn&apos;t available</h1>
        <p className="mt-2 text-muted">Please call the business to set up a visit.</p>
      </main>
    );
  return <BookingForm slug={store.slug} name={store.name} service={store.settings.service} />;
}
