import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { env } from "./env";
import { SYSTEM_PROMPT } from "./systemPrompt.generated";
import { SUBMIT_ESTIMATE_TOOL, handleSubmitEstimate } from "./estimateTool";
import type { Estimate, PricingResult } from "@ce/core";

function todayNY(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function weekdayNY(): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date());
}

export interface ChatTurnResult {
  conversation: MessageParam[];
  reply: string;
  review: { estimate: Estimate; computed: PricingResult } | null;
}

/**
 * One merchant message in, one assistant reply out.
 * If Claude calls submit_estimate, validate + price it in code; on bad input, hand the error back to Claude (max 3 tries).
 */
export async function runChatTurn(conversation: MessageParam[], userContent: ContentBlockParam[]): Promise<ChatTurnResult> {
  const client = new Anthropic({ apiKey: env.anthropicKey() });
  const system = `${SYSTEM_PROMPT}\n\nToday is ${weekdayNY()}, ${todayNY()} (America/New_York). Use this to resolve dates like "Saturday" or "30 days".`;
  const convo: MessageParam[] = [...conversation, { role: "user", content: userContent }];
  let review: ChatTurnResult["review"] = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await client.messages.create({
      model: env.model,
      max_tokens: 1024,
      system,
      tools: [SUBMIT_ESTIMATE_TOOL],
      messages: convo,
    });
    convo.push({ role: "assistant", content: res.content as ContentBlockParam[] });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();

    if (toolUses.length === 0) return { conversation: convo, reply: text, review };

    const results: ToolResultBlockParam[] = toolUses.map((tu) => {
      const t = tu as { id: string; name: string; input: unknown };
      if (t.name !== "submit_estimate") return { type: "tool_result", tool_use_id: t.id, is_error: true, content: "Unknown tool" };
      const outcome = handleSubmitEstimate(t.input, { taxRate: env.taxRate(), paymentProgram: env.paymentProgram() });
      if (!outcome.ok) return { type: "tool_result", tool_use_id: t.id, is_error: true, content: outcome.error };
      review = { estimate: outcome.estimate, computed: outcome.computed };
      return {
        type: "tool_result",
        tool_use_id: t.id,
        content: "Saved. The app is now showing the owner a review card with the final math. Tell them in one short line to check it and tap Approve and send, or tell you what to change. Do not repeat the numbers.",
      };
    });
    convo.push({ role: "user", content: results });
  }
  return { conversation: convo, reply: "Sorry, I got stuck. Can you say that again?", review };
}
