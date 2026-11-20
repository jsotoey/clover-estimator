import { isAuthed } from "@/lib/auth";
import PinScreen from "./components/PinScreen";
import EstimateApp from "./components/EstimateApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (await isAuthed()) ? <EstimateApp /> : <PinScreen />;
}
