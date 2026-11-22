import { getSession } from "@/lib/session";
import PinScreen from "../components/PinScreen";
import CloverConnect from "../components/CloverConnect";

export const dynamic = "force-dynamic";

export default async function CloverPage() {
  const s = await getSession();
  return s ? <CloverConnect businessName={s.merchant.name} admin={s.role === "admin"} /> : <PinScreen />;
}
