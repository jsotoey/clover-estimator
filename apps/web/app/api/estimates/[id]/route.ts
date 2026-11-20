import { db, getEstimate } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Status for the review card / banner. Conversation is not returned. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return unauthorized();
  const { id } = await ctx.params;
  const e = await getEstimate(id);
  if (!e) return Response.json({ error: "Not found" }, { status: 404 });
  // While a Clover sign-in is open, the worker is busy with it; say so instead of "putting it into Clover".
  const login = await db().query(`SELECT 1 FROM clover_login WHERE status IN ('requested','active') LIMIT 1`);
  return Response.json({
    signInOpen: login.rowCount! > 0,
    id: e.id,
    status: e.status,
    estimate: e.estimate,
    computed: e.computed,
    cloverEstimateNumber: e.clover_estimate_number,
    error: e.error,
    screenshots: e.screenshot_urls,
    photos: e.photo_urls,
  });
}
