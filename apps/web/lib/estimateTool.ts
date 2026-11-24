import { EstimateSchema, priceEstimate, type Estimate, type PaymentProgram, type PricingResult } from "@ce/core";

/** Tool definition sent to Claude. Mirrors prompts/estimate-assistant.md. */
export const SUBMIT_ESTIMATE_TOOL = {
  name: "submit_estimate",
  description: "Put the estimate in front of the owner as a finished document (the app does the math). Call as soon as you have the customer name, email, the work and price, and the start date; use the standard terms for everything else. Call again after any change.",
  input_schema: {
    type: "object" as const,
    required: ["customer", "line_items", "service_date", "completion_date", "deposit_percent", "deposit_due_date", "expiration_date", "taxable", "delivery", "note"],
    properties: {
      customer: {
        type: "object",
        required: ["name", "email"],
        properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, job_address: { type: "string" } },
      },
      line_items: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["description", "price"],
          properties: {
            description: { type: "string", maxLength: 80 },
            price: { type: "number", description: "Exactly what the owner said, in dollars, before tax and fees" },
          },
        },
      },
      service_date: { type: "string", description: "YYYY-MM-DD" },
      completion_date: { type: "string", description: "YYYY-MM-DD" },
      deposit_percent: { type: "number", minimum: 0, maximum: 100 },
      deposit_due_date: { type: "string", description: "YYYY-MM-DD" },
      expiration_date: { type: "string", description: "YYYY-MM-DD" },
      taxable: { type: "boolean" },
      delivery: { type: "string", enum: ["email", "sms", "both"] },
      note: { type: "string", maxLength: 200 },
      supplier: { type: "string", description: "Only for stores with a supplier list: the supplier the materials come from, spelled exactly as listed" },
    },
  },
};

export type ToolOutcome =
  | { ok: true; estimate: Estimate; computed: PricingResult }
  | { ok: false; error: string };

/** Validate the AI's tool input and run the pricing code. The AI's numbers are never trusted for math. */
export function handleSubmitEstimate(
  input: unknown,
  settings: { taxRate: number; paymentProgram: PaymentProgram }
): ToolOutcome {
  const parsed = EstimateSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "estimate"}: ${i.message}`).join("; ");
    return { ok: false, error: `Not valid yet: ${msg}. Ask the owner for what's missing, then call submit_estimate again.` };
  }
  const e = parsed.data;
  const computed = priceEstimate({
    lineItems: e.line_items,
    taxable: e.taxable,
    taxRate: settings.taxRate,
    paymentProgram: settings.paymentProgram,
    depositPercent: e.deposit_percent,
  });
  return { ok: true, estimate: e, computed };
}

/** Tappable choices for one simple question. The owner's tap (or typed answer) comes back as the tool result. */
export const ASK_OWNER_TOOL = {
  name: "ask_owner",
  description: "Ask the owner ONE simple choice question with 2-4 tappable options. Use date_picker for dates. Not for names, emails or prices.",
  input_schema: {
    type: "object" as const,
    required: ["question", "options"],
    properties: {
      question: { type: "string", description: "Short, plain text" },
      options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 30 } },
      date_picker: { type: "boolean", description: "Also show a calendar to pick a date" },
    },
  },
};

export interface AskOwner { question: string; options: string[]; datePicker: boolean }

export function parseAskOwner(input: unknown): AskOwner | null {
  const i = input as { question?: unknown; options?: unknown; date_picker?: unknown };
  if (typeof i?.question !== "string" || !Array.isArray(i.options)) return null;
  const options = i.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).slice(0, 4);
  return { question: i.question.trim(), options, datePicker: i.date_picker === true };
}
