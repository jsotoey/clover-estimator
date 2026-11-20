import { getEstimate } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Status for the review card / banner. Conversation is not returned. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return unauthorized();
  const { id } = await ctx.params;
  const e = await getEstimate(id);
  if (!e) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
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
