import { getSession } from "@/lib/session";
import PinScreen from "./components/PinScreen";
import EstimateApp from "./components/EstimateApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const missing = ["ANTHROPIC_API_KEY", "DATABASE_URL"].filter((k) => !process.env[k]);
  if (!process.env.MERCHANT_PIN && !process.env.ADMIN_PIN) missing.push("ADMIN_PIN");
  if (missing.length)
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-semibold">Almost ready</h1>
        <p className="mt-2 text-muted">Add these in Railway → web → Variables, then it redeploys on its own:</p>
        <ul className="mt-3 list-disc pl-5 font-mono text-sm">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
      </main>
    );
  const s = await getSession();
  return s
    ? <EstimateApp businessName={s.merchant.name} taxRate={s.merchant.taxRate} admin={s.role === "admin"} />
    : <PinScreen />;
}
