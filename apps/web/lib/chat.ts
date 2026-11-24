import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { env } from "./env";
import { SYSTEM_PROMPT } from "./systemPrompt.generated";
import { ASK_OWNER_TOOL, SUBMIT_ESTIMATE_TOOL, handleSubmitEstimate, parseAskOwner, type AskOwner } from "./estimateTool";
import type { Estimate, PricingResult, PaymentProgram } from "@ce/core";

/** The store's own terms (from its row in merchants). Defaults come from env for tests and old setups. */
export interface StoreTerms { depositPercent: number; validDays: number; taxable: boolean; taxRate: number; paymentProgram: PaymentProgram; suppliers?: { name: string; leadDays: number }[] }

function todayNY(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function weekdayNY(): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date());
}

export function buildSystemPrompt(t: Pick<StoreTerms, "depositPercent" | "validDays" | "taxable" | "suppliers"> = env.terms()): string {
  const prompt = SYSTEM_PROMPT
    .replaceAll("{{DEPOSIT}}", String(t.depositPercent))
    .replaceAll("{{VALID_DAYS}}", String(t.validDays))
    .replaceAll("{{TAX}}", t.taxable ? "yes, the business's sales tax applies" : "no");
  const sup = t.suppliers?.length
    ? `\n\nThis business orders materials from: ${t.suppliers.map((x) => `${x.name} (about ${x.leadDays} days)`).join(", ")}. ` +
      `If the job uses ordered materials and the owner hasn't said where from, ask which supplier with ask_owner (the supplier names as options, plus "No special order"). ` +
      `Put the exact name in "supplier". The install date is planned from the supplier's wait, so don't invent one.`
    : "";
  return `${prompt}${sup}\n\nToday is ${weekdayNY()}, ${todayNY()} (America/New_York). Use this to resolve dates like "Saturday" or "30 days".`;
}

/** Remove markdown the model may still produce, so the chat reads as plain text. */
export function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[-*]\s+/gm, "").replace(/^#+\s*/gm, "").trim();
}

export interface ChatTurnResult {
  conversation: MessageParam[];
  reply: string;
  review: { estimate: Estimate; computed: PricingResult } | null;
  ask: AskOwner | null;
}

type ToolUse = { type: "tool_use"; id: string; name: string; input: unknown };

/**
 * The owner's message answers any tool calls left open from the last turn (an ask_owner question).
 * The API needs every tool_use answered by a tool_result in the next user message.
 */
export function withOpenToolResults(conversation: MessageParam[], userContent: ContentBlockParam[]): ContentBlockParam[] {
  const last = conversation[conversation.length - 1];
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return userContent;
  const open = (last.content as ContentBlockParam[]).filter((b): b is ToolUse & ContentBlockParam => b.type === "tool_use");
  if (open.length === 0) return userContent;
  const answer = userContent.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  const results: ToolResultBlockParam[] = open.map((t) => ({
    type: "tool_result",
    tool_use_id: t.id,
    content: t.name === "ask_owner" ? `Owner's answer: ${answer}` : "Shown to the owner.",
  }));
  return [...results, ...userContent.filter((b) => b.type !== "text"), ...(open.some((t) => t.name === "ask_owner") ? [] : userContent.filter((b) => b.type === "text"))];
}

/**
 * One owner message in, one assistant reply out.
 * submit_estimate: validated and priced in code (bad input goes back to Claude, max 3 tries).
 * ask_owner: ends the turn; the app shows the question with tappable choices.
 */
export async function runChatTurn(conversation: MessageParam[], userContent: ContentBlockParam[], store: StoreTerms): Promise<ChatTurnResult> {
  const client = new Anthropic({ apiKey: env.anthropicKey() });
  const system = buildSystemPrompt(store);
  const convo: MessageParam[] = [...conversation, { role: "user", content: withOpenToolResults(conversation, userContent) }];
  let review: ChatTurnResult["review"] = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await client.messages.create({
      model: env.model,
      max_tokens: 1024,
      system,
      tools: [SUBMIT_ESTIMATE_TOOL, ASK_OWNER_TOOL],
      messages: convo,
    });
    convo.push({ role: "assistant", content: res.content as ContentBlockParam[] });

    const toolUses = res.content.filter((b) => b.type === "tool_use") as unknown as ToolUse[];
    const text = plain(res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n"));

    if (toolUses.length === 0) return { conversation: convo, reply: text, review, ask: null };

    // Price any estimate now, even if a question is also being asked.
    const results: ToolResultBlockParam[] = [];
    let ask: AskOwner | null = null;
    for (const t of toolUses) {
      if (t.name === "ask_owner") {
        ask = parseAskOwner(t.input);
        continue;
      }
      if (t.name !== "submit_estimate") {
        results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: "Unknown tool" });
        continue;
      }
      const outcome = handleSubmitEstimate(t.input, { taxRate: store.taxRate, paymentProgram: store.paymentProgram });
      if (!outcome.ok) {
        results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: outcome.error });
        continue;
      }
      review = { estimate: outcome.estimate, computed: outcome.computed };
      results.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: "The owner now sees the finished estimate with Approve and Change buttons. Reply with one short plain sentence (for example: \"Here's the estimate. Tap Approve to send it, or tell me what to change.\"). Do not repeat any details or numbers.",
      });
    }

    if (ask) {
      // Leave every tool call open; the owner's next message answers them (see withOpenToolResults).
      return { conversation: convo, reply: plain(!text || text.includes(ask.question) ? text || ask.question : `${text}\n${ask.question}`), review, ask };
    }
    convo.push({ role: "user", content: results });
  }
  return { conversation: convo, reply: "Sorry, I got stuck. Can you say that again?", review, ask: null };
}
