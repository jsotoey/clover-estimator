/**
 * All customer-facing math lives here. The AI never calculates.
 * Everything is done in integer cents and rounded half-up.
 */
export type PaymentProgram = "none" | "surcharge" | "cash_discount";

export interface PricingInput {
  lineItems: { description: string; price: number }[]; // merchant's exact base prices, dollars
  taxable: boolean;
  taxRate: number; // ONE rate, e.g. 0.06625
  paymentProgram: PaymentProgram;
  depositPercent: number; // 0-100
}

export interface PricedLine {
  description: string;
  basePriceCents: number;
  priceCents: number; // what goes on the Clover estimate
}

export interface PricingResult {
  lines: PricedLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
}

/** Cash-discount card price divisor. Card price = base / 0.96 (never base x 1.04). */
export const CASH_DISCOUNT_DIVISOR = 0.96;

function roundHalfUp(x: number): number {
  // Guard against float noise like 53312.499999999
  return Math.round(Number((x).toFixed(6)));
}

export function toCents(dollars: number): number {
  return roundHalfUp(dollars * 100);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function priceEstimate(input: PricingInput): PricingResult {
  if (!(input.taxRate >= 0 && input.taxRate < 0.25)) throw new Error(`Suspicious tax rate: ${input.taxRate}`);
  if (!(input.depositPercent >= 0 && input.depositPercent <= 100)) throw new Error("Deposit percent must be 0-100");
  if (input.lineItems.length === 0) throw new Error("At least one line item is required");

  const lines: PricedLine[] = input.lineItems.map((li) => {
    if (!(li.price > 0)) throw new Error(`Invalid price for "${li.description}"`);
    const basePriceCents = toCents(li.price);
    const priceCents =
      input.paymentProgram === "cash_discount"
        ? roundHalfUp(basePriceCents / CASH_DISCOUNT_DIVISOR)
        : basePriceCents; // "none" and "surcharge": Clover applies any surcharge at payment
    return { description: li.description, basePriceCents, priceCents };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.priceCents, 0);
  const taxCents = input.taxable ? roundHalfUp(subtotalCents * input.taxRate) : 0;
  const totalCents = subtotalCents + taxCents;
  const depositCents = roundHalfUp((totalCents * input.depositPercent) / 100);
  const balanceCents = totalCents - depositCents;

  return { lines, subtotalCents, taxCents, totalCents, depositCents, balanceCents };
}

export interface InvoicePart { subtotalCents: number; taxCents: number; totalCents: number }

/**
 * Split an estimate into a deposit invoice and a balance invoice, the way Clover will bill them:
 * each invoice is its own taxed line (so the merchant's sales-tax reports stay right) and Clover
 * rounds tax per invoice. The two can therefore differ from the estimate total by a cent.
 * depositPercent 0 means a single "balance" invoice for everything.
 */
export function splitInvoices(subtotalCents: number, taxRate: number, taxable: boolean, depositPercent: number): { deposit: InvoicePart | null; balance: InvoicePart } {
  if (!(depositPercent >= 0 && depositPercent <= 100)) throw new Error("Deposit percent must be 0-100");
  const tax = (c: number) => (taxable ? roundHalfUp(c * taxRate) : 0);
  const part = (c: number): InvoicePart => ({ subtotalCents: c, taxCents: tax(c), totalCents: c + tax(c) });
  const depSub = roundHalfUp((subtotalCents * depositPercent) / 100);
  return { deposit: depSub > 0 ? part(depSub) : null, balance: part(subtotalCents - depSub) };
}
