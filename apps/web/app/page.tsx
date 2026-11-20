import { formatCents, priceEstimate } from "@ce/core";

// Milestone 1 placeholder: proves the web app builds and shares the pricing code.
// Milestone 3 replaces this with the PIN screen, chat, photos and review card.
export default function Home() {
  const sample = priceEstimate({
    lineItems: [{ description: "Kitchen cabinets", price: 1000 }],
    taxable: true,
    taxRate: 0.06625,
    paymentProgram: "none",
    depositPercent: 50,
  });
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Estimate Assistant</h1>
      <p className="mt-2 text-neutral-600">Chat coming in milestone 3.</p>
      <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-500">Pricing check: $1,000 cabinets, 6.625% tax, 50% deposit</p>
        <p className="mt-1">Total {formatCents(sample.totalCents)}, deposit {formatCents(sample.depositCents)}, balance {formatCents(sample.balanceCents)}</p>
      </div>
    </main>
  );
}
