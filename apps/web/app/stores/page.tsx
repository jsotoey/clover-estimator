import { getSession } from "@/lib/session";
import PinScreen from "../components/PinScreen";
import StoresAdmin from "../components/StoresAdmin";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const s = await getSession();
  if (!s) return <PinScreen />;
  if (s.role !== "admin")
    return <main className="mx-auto max-w-md p-6"><p className="text-sm">Only the admin can manage stores. <a href="/" className="font-semibold text-brand underline">Back</a></p></main>;
  return <StoresAdmin businessName={s.merchant.name} />;
}
