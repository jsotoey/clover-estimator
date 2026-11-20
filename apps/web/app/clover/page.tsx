import { isAuthed } from "@/lib/auth";
import PinScreen from "../components/PinScreen";
import CloverConnect from "../components/CloverConnect";

export const dynamic = "force-dynamic";

export default async function CloverPage() {
  return (await isAuthed()) ? <CloverConnect /> : <PinScreen />;
}
