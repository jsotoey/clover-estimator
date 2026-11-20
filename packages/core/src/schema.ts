import { z } from "zod";

/** Mirrors the submit_estimate tool in prompts/estimate-assistant.md. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const LineItemSchema = z.object({
  description: z.string().min(1).max(80),
  price: z.number().positive(),
});

export const EstimateSchema = z
  .object({
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().email(), // Clover requires an email to create a customer
      job_address: z.string().optional(),
    }),
    line_items: z.array(LineItemSchema).min(1),
    service_date: isoDate,
    completion_date: isoDate,
    deposit_percent: z.number().min(0).max(100),
    deposit_due_date: isoDate,
    expiration_date: isoDate,
    taxable: z.boolean(),
    delivery: z.enum(["email", "sms", "both"]),
    note: z.string().max(200),
    photo_ids: z.array(z.string()).max(3).optional(),
  })
  .superRefine((e, ctx) => {
    const needPhone = e.delivery === "sms" || e.delivery === "both";
    if (needPhone && !e.customer.phone)
      ctx.addIssue({ code: "custom", path: ["customer", "phone"], message: "Phone needed for text delivery" });
  });

export type LineItem = z.infer<typeof LineItemSchema>;
export type Estimate = z.infer<typeof EstimateSchema>;

export const ESTIMATE_STATUSES = [
  "drafting",
  "ready_for_review",
  "approved",
  "sending",
  "needs_code",
  "sent",
  "failed",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

/** Clover estimate limits. */
export const CLOVER_LIMITS = { noteMaxChars: 200, maxAttachments: 3, maxAttachmentBytes: 25 * 1024 * 1024 } as const;
