import { isAuthed } from "@/lib/auth";
import { env } from "@/lib/env";
import PinScreen from "../components/PinScreen";
import CloverConnect from "../components/CloverConnect";

export const dynamic = "force-dynamic";

export default async function CloverPage() {
  return (await isAuthed()) ? <CloverConnect businessName={env.businessName()} /> : <PinScreen businessName={env.businessName()} />;
}
