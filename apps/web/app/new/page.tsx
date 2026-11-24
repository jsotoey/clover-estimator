import { getSession } from "@/lib/session";
import PinScreen from "../components/PinScreen";
import EstimateApp from "../components/EstimateApp";

export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await getSession();
  return s
    ? <EstimateApp businessName={s.merchant.name} taxRate={s.merchant.taxRate} admin={s.role === "admin"} start="chat" />
    : <PinScreen />;
}
