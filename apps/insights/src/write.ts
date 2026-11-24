import Anthropic from "@anthropic-ai/sdk";
import type { Merchant } from "./types.js";
import { usd, signed, type WeeklyReport } from "./metrics.js";

export interface Draft {
  subject: string;
  greeting: string;
  intro: string;
  highlights: string[];  // 3–4 short bullets
  idea: string;          // one practical suggestion
  signoff: string;
  writer: "ai" | "template";
}

/** Every number token in a text: $1,234 / $12.34 / 45% / 123. */
export function numberTokens(text: string): string[] {
  return (text.match(/\$[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((t) => t.replace(/,/g, ""));
}

/** True when every number in the draft appears in the facts. Stops the AI from inventing figures. */
export function numbersCheckOut(d: Draft, factLines: string[]): { ok: boolean; bad: string[] } {
  const allowed = new Set(numberTokens(factLines.join(" ")));
  const text = [d.subject, d.intro, ...d.highlights, d.idea].join(" ");
  const bad = numberTokens(text).filter((t) => !allowed.has(t));
  return { ok: bad.length === 0, bad };
}

const STYLE = `You write a short weekly check-in email from Jon, the merchant's payments and POS rep, to a small-business owner.
Voice: friendly, confident, conversational, like a person who knows their business. Less is more.
Rules:
- Use ONLY the facts given. Never invent or compute a number. Copy numbers exactly as written in the facts.
- No em dashes. No corporate jargon. No hype or sales pitch.
- 3 or 4 highlights, one short sentence each, most interesting first. Mix good news with anything worth watching.
- One practical idea tied to a fact (e.g. feature the climbing item, staff up the busiest hour). Don't promise results.
- Subject under 60 characters, specific to their week.
Reply with JSON only: {"subject": "", "intro": "", "highlights": ["", ""], "idea": ""}`;

export async function writeDraft(m: Merchant, r: WeeklyReport, factLines: string[], apiKey?: string): Promise<Draft> {
  const greeting = `Hi ${m.contactName},`;
  const signoff = "Talk soon,\nJon";
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 800,
        system: STYLE,
        messages: [{ role: "user", content: `Business: ${m.name}\nFacts for last week:\n- ${factLines.join("\n- ")}` }],
      });
      const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      const d: Draft = {
        subject: String(j.subject), greeting, intro: String(j.intro),
        highlights: (j.highlights as unknown[]).map(String).slice(0, 4), idea: String(j.idea), signoff, writer: "ai",
      };
      const check = numbersCheckOut(d, factLines);
      const dashes = /—/.test([d.subject, d.intro, ...d.highlights, d.idea].join(" "));
      if (check.ok && !dashes && d.highlights.length >= 2) return d;
      console.warn(`[insights] ${m.name}: AI draft rejected (${check.ok ? "em dash" : `numbers not in facts: ${check.bad.join(", ")}`}); using template`);
    } catch (e) {
      console.warn(`[insights] ${m.name}: AI writer failed (${e instanceof Error ? e.message : e}); using template`);
    }
  }
  return templateDraft(m, r, greeting, signoff);
}

/** No-AI fallback: plain but accurate. */
export function templateDraft(m: Merchant, r: WeeklyReport, greeting = `Hi ${m.contactName},`, signoff = "Talk soon,\nJon"): Draft {
  const w = r.week;
  const hl: string[] = [];
  hl.push(`${usd(w.salesCents)} in sales from ${w.orders} orders${r.salesVsPrevPct !== null ? `, ${signed(r.salesVsPrevPct)} vs the week before` : ""}.`);
  const top = r.topItems[0], rise = r.risers[0];
  if (top && rise && top.name === rise.name) hl.push(`${top.name} was your top seller (${top.qty} sold) and it's climbing, ${signed(rise.changePct!)} vs its usual week.`);
  else {
    if (top) hl.push(`${top.name} was your top seller: ${top.qty} sold for ${usd(top.cents)}.`);
    if (rise) hl.push(`${rise.name} is climbing, ${signed(rise.changePct!)} vs its usual week.`);
  }
  if (r.fallers[0]) hl.push(`${r.fallers[0].name} dipped, ${Math.abs(r.fallers[0].changePct!)}% below its usual week.`);
  if (r.bestDay) hl.push(`${r.bestDay.day} was your best day at ${usd(r.bestDay.salesCents)}.`);
  const idea = r.risers[0]
    ? `${r.risers[0].name} is picking up. Might be worth putting it front and center this week.`
    : r.busiestHour ? `${r.busiestHour.label} is your rush. Worth making sure you're fully staffed then.` : "Nothing urgent this week. Keep it rolling.";
  return {
    subject: `Your week at ${m.name}: ${usd(w.salesCents)} in sales`,
    greeting, intro: `Here's your quick snapshot for last week.`, highlights: hl.slice(0, 4), idea, signoff, writer: "template",
  };
}
