import type { PaymentProgram } from "@ce/core";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  anthropicKey: () => req("ANTHROPIC_API_KEY"),
  databaseUrl: () => req("DATABASE_URL"),
  pin: () => req("MERCHANT_PIN"),
  taxRate: () => {
    const r = Number(req("MERCHANT_TAX_RATE"));
    if (!(r >= 0 && r < 0.25)) throw new Error(`MERCHANT_TAX_RATE looks wrong: ${r} (use 0.06625, not 6.625)`);
    return r;
  },
  paymentProgram: (): PaymentProgram => {
    const p = (process.env.PAYMENT_PROGRAM ?? "none") as PaymentProgram;
    if (!["none", "surcharge", "cash_discount"].includes(p)) throw new Error(`PAYMENT_PROGRAM must be none | surcharge | cash_discount`);
    return p;
  },
  /** The business's standard terms, used unless the owner says otherwise. */
  terms: () => {
    const deposit = Number(process.env.DEFAULT_DEPOSIT_PERCENT ?? 50);
    const validDays = Number(process.env.DEFAULT_VALID_DAYS ?? 30);
    const taxable = (process.env.DEFAULT_TAXABLE ?? "true").toLowerCase() !== "false";
    return {
      depositPercent: deposit >= 0 && deposit <= 100 ? deposit : 50,
      validDays: validDays > 0 && validDays <= 365 ? validDays : 30,
      taxable,
    };
  },
  businessName: () => process.env.BUSINESS_NAME ?? "",
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
};
