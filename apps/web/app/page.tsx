import { isAuthed } from "@/lib/auth";
import PinScreen from "./components/PinScreen";
import EstimateApp from "./components/EstimateApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const missing = ["MERCHANT_PIN", "ANTHROPIC_API_KEY", "DATABASE_URL", "MERCHANT_TAX_RATE"].filter((k) => !process.env[k]);
  if (missing.length)
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-semibold">Almost ready</h1>
        <p className="mt-2 text-neutral-600">Add these in Railway → web → Variables, then it redeploys on its own:</p>
        <ul className="mt-3 list-disc pl-5 font-mono text-sm">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
      </main>
    );
  return (await isAuthed()) ? <EstimateApp /> : <PinScreen />;
}
