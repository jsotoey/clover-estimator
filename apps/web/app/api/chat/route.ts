import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { db, getEstimate } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";
import { runChatTurn } from "@/lib/chat";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const { estimateId, message, photoCount } = (await req.json().catch(() => ({}))) as {
    estimateId?: string; message?: string; photoCount?: number;
  };
  if (!estimateId || (!message?.trim() && !photoCount)) return Response.json({ error: "Say something first" }, { status: 400 });
  const e = await getEstimate(estimateId);
  if (!e) return Response.json({ error: "Estimate not found" }, { status: 404 });
  if (!["drafting", "ready_for_review"].includes(e.status))
    return Response.json({ error: "This estimate was already approved. Start a new one to make changes." }, { status: 409 });

  const parts: string[] = [];
  if (message?.trim()) parts.push(message.trim());
  if (photoCount) parts.push(`[The owner attached ${photoCount} photo${photoCount > 1 ? "s" : ""}. They will be added to the estimate automatically.]`);
  const userContent: ContentBlockParam[] = [{ type: "text", text: parts.join("\n\n") }];

  try {
    const turn = await runChatTurn(e.conversation as MessageParam[], userContent);
    // A new estimate replaces the old one. A message that changes nothing (a question, "looks good")
    // keeps the current estimate ready to approve; real changes come back as a new submit_estimate.
    const status = turn.review || (e.status === "ready_for_review" && e.estimate) ? "ready_for_review" : "drafting";
    await db().query(
      `UPDATE estimates SET conversation = $2, status = $3,
         estimate = CASE WHEN $4::jsonb IS NULL THEN estimate ELSE $4::jsonb END,
         computed = CASE WHEN $5::jsonb IS NULL THEN computed ELSE $5::jsonb END,
         updated_at = now() WHERE id = $1`,
      [estimateId, JSON.stringify(turn.conversation), status,
       turn.review ? JSON.stringify(turn.review.estimate) : null,
       turn.review ? JSON.stringify(turn.review.computed) : null]
    );
    return Response.json({ reply: turn.reply, review: turn.review, ask: turn.ask, status });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "The assistant had a problem. Try again in a moment." }, { status: 502 });
  }
}
