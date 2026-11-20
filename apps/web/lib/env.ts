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
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
};
