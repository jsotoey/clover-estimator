import { getSession } from "@/lib/session";
import PinScreen from "../components/PinScreen";
import VisitsList from "../components/VisitsList";

export const dynamic = "force-dynamic";

export default async function VisitsPage() {
  const s = await getSession();
  return s ? <VisitsList businessName={s.merchant.name} /> : <PinScreen />;
}
