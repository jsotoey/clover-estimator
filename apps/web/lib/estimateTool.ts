import { EstimateSchema, priceEstimate, type Estimate, type PaymentProgram, type PricingResult } from "@ce/core";

/** Tool definition sent to Claude. Mirrors prompts/estimate-assistant.md. */
export const SUBMIT_ESTIMATE_TOOL = {
  name: "submit_estimate",
  description: "Send the confirmed estimate to the app for math, review and Clover entry. Only call after the owner confirms the summary.",
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
